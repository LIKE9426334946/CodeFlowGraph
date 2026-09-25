import { promises as fs } from "node:fs";
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
function validateFile(file, type) {
  const limit = type === "svg" ? 30_000_000 : 2_000_000;
  if (
    !file ||
    typeof file.name !== "string" ||
    !file.name.trim() ||
    file.name.length > 150 ||
    /[/\\\x00-\x1f]/.test(file.name) ||
    typeof file.content !== "string"
  )
    throw new HttpError(400, "文件格式无效");
  if (Buffer.byteLength(file.content, "utf8") > limit)
    throw new HttpError(
      413,
      type === "svg" ? "SVG 不能超过 30 MB" : "代码不能超过 2 MB",
    );
  if (
    type === "svg" &&
    (!file.name.toLowerCase().endsWith(".svg") ||
      !/<svg[\s>]/i.test(file.content))
  )
    throw new HttpError(400, "请选择有效的 SVG 文件");
  return { name: file.name, content: file.content };
}

// Import the previous active file once. The old project directories stay intact.
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
  const file =
    project.files.find((f) => f.id === project.ui?.activeFileId) ||
    project.files[0];
  if (!file || !validId(file.id)) throw new Error("旧版代码文件格式无效");
  return {
    code: {
      name: file.name,
      content: await fs.readFile(
        path.join(snapshot, "sources", `${file.id}.py`),
        "utf8",
      ),
    },
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
      return await readJSON(metadataPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const legacy = await readLegacy(root);
    const document = {
      schemaVersion: 2,
      revision: 1,
      code: legacy?.code || { name: "model.py", content: "" },
      svg: await saveSvg(legacy?.svg),
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
              "其他管理页已保存内容。请复制本页代码后刷新，再继续编辑。",
            );
          const code = Object.hasOwn(input, "code")
            ? validateFile(input.code, "code")
            : old.code;
          const svg = Object.hasOwn(input, "svg")
            ? await saveSvg(
                input.svg === null ? null : validateFile(input.svg, "svg"),
              )
            : old.svg;
          const next = {
            schemaVersion: 2,
            revision: old.revision + 1,
            code,
            svg,
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
