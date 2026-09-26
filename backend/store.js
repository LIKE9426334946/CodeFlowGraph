import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const validId = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const readJSON = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
async function atomicJSON(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx");
  try {
    await handle.writeFile(JSON.stringify(value, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, file);
}
function validateFile(file) {
  if (
    !file ||
    typeof file.name !== "string" ||
    !file.name.trim() ||
    file.name.length > 150 ||
    /[/\\\x00-\x1f]/.test(file.name) ||
    typeof file.content !== "string"
  )
    throw new HttpError(400, "文件格式无效");
  if (Buffer.byteLength(file.content, "utf8") > 30_000_000)
    throw new HttpError(413, "SVG 不能超过 30 MB");
  if (
    !file.name.toLowerCase().endsWith(".svg") ||
    !/<svg[\s>]/i.test(file.content)
  )
    throw new HttpError(400, "请选择有效的 SVG 文件");
  return { name: file.name, content: file.content };
}

function validateLabels(labels) {
  if (!Array.isArray(labels) || labels.length > 1000)
    throw new HttpError(400, "标签数量不能超过 1000 个");
  const ids = new Set();
  return labels.map((label) => {
    if (
      !label ||
      !validId(label.id) ||
      ids.has(label.id) ||
      typeof label.text !== "string" ||
      !label.text.trim() ||
      label.text.length > 1000 ||
      !Number.isFinite(label.x) ||
      Math.abs(label.x) > 2e8 ||
      !Number.isFinite(label.y) ||
      Math.abs(label.y) > 2e8 ||
      !Number.isFinite(label.fontSize) ||
      label.fontSize < 0.01 ||
      label.fontSize > 100000
    )
      throw new HttpError(400, "标签需要有效的文字、坐标和字号");
    ids.add(label.id);
    return {
      id: label.id,
      text: label.text.trim(),
      x: label.x,
      y: label.y,
      fontSize: label.fontSize,
    };
  });
}

// Import only the previous SVG. Old source files and project folders stay intact.
async function readLegacy(root) {
  let activeId;
  try {
    activeId = (await readJSON(path.join(root, "workspace.json")))
      .activeProjectId;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const directory = path.join(root, "projects");
  let ids;
  try {
    ids = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && validId(e.name))
      .map((e) => e.name);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (ids.includes(activeId)) ids = [activeId];
  const candidates = [];
  for (const id of ids) {
    const folder = path.join(directory, id);
    let pointer;
    try {
      pointer = await readJSON(path.join(folder, "current.json"));
    } catch (error) {
      if (error.code === "ENOENT" && id !== activeId) continue;
      throw error;
    }
    if (!validId(pointer.version)) throw new Error("旧版项目版本格式无效");
    const snapshot = path.join(folder, "versions", pointer.version);
    const project = await readJSON(path.join(snapshot, "project.json"));
    candidates.push({ id, snapshot, project });
  }
  const selected =
    candidates.find((p) => p.id === activeId) ||
    candidates.sort((a, b) =>
      String(b.project.updatedAt).localeCompare(String(a.project.updatedAt)),
    )[0];
  if (!selected) return null;
  const { project, snapshot } = selected;
  return {
    svg: project.svg
      ? {
          name: project.svg.name,
          content: await fs.readFile(
            path.join(snapshot, "network.svg"),
            "utf8",
          ),
        }
      : null,
  };
}

export function createStore(dataDir) {
  const root = path.resolve(dataDir),
    metadataPath = path.join(root, "content.json");
  let loaded,
    queue = Promise.resolve();
  async function saveSvg(svg) {
    if (!svg) return null;
    const hash = createHash("sha256").update(svg.content).digest("hex");
    const file = path.join(root, "svg", `${hash}.svg`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      const handle = await fs.open(file, "wx");
      try {
        await handle.writeFile(svg.content);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    return { name: svg.name, hash };
  }
  async function initialize() {
    await fs.mkdir(root, { recursive: true });
    try {
      const old = await readJSON(metadataPath);
      if (old.schemaVersion === 3) return old;
      if (old.schemaVersion !== 2) throw new Error("不支持的内容版本");
      // Keep an exact backup, including the removed code, before migrating.
      try {
        await fs.copyFile(
          metadataPath,
          path.join(root, "content-v2.backup.json"),
          constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const migrated = {
        schemaVersion: 3,
        revision: old.revision + 1,
        svg: old.svg,
        labels: [],
        updatedAt: new Date().toISOString(),
      };
      await atomicJSON(metadataPath, migrated);
      return migrated;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const legacy = await readLegacy(root);
    const document = {
      schemaVersion: 3,
      revision: 1,
      svg: await saveSvg(legacy?.svg),
      labels: [],
      updatedAt: new Date().toISOString(),
    };
    await atomicJSON(metadataPath, document);
    return document;
  }
  const metadata = () =>
    (loaded ||= initialize().catch((error) => {
      loaded = null;
      throw error;
    }));
  return {
    async state() {
      const p = await metadata();
      return { revision: p.revision, updatedAt: p.updatedAt };
    },
    async read() {
      const p = await metadata();
      return {
        ...p,
        svg: p.svg
          ? {
              name: p.svg.name,
              content: await fs.readFile(
                path.join(root, "svg", `${p.svg.hash}.svg`),
                "utf8",
              ),
            }
          : null,
      };
    },
    save(input) {
      const operation = queue
        .catch(() => {})
        .then(async () => {
          const old = await metadata();
          if (input?.revision !== old.revision)
            throw new HttpError(
              409,
              "其他页面已保存更新，本页修改暂未保存。请先保留标签文字，再刷新页面继续编辑。",
            );
          if (
            Object.keys(input).some(
              (key) => !["revision", "svg", "labels"].includes(key),
            )
          )
            throw new HttpError(400, "仅支持保存 SVG 和标签");
          // Validate before writing any SVG or metadata.
          const suppliedLabels = Object.hasOwn(input, "labels")
            ? validateLabels(input.labels)
            : null;
          const svg = Object.hasOwn(input, "svg")
            ? await saveSvg(input.svg === null ? null : validateFile(input.svg))
            : old.svg;
          const labels =
            suppliedLabels ?? (svg?.hash === old.svg?.hash ? old.labels : []);
          if (!svg && labels.length)
            throw new HttpError(400, "请先上传 SVG，再添加标签");
          const next = {
            schemaVersion: 3,
            revision: old.revision + 1,
            svg,
            labels,
            updatedAt: new Date().toISOString(),
          };
          await atomicJSON(metadataPath, next);
          loaded = Promise.resolve(next);
          return { revision: next.revision, updatedAt: next.updatedAt };
        });
      queue = operation;
      return operation;
    },
  };
}
