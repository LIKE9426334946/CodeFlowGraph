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

function validateName(name) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 150 ||
    /[\x00-\x1f]/.test(name)
  )
    throw new HttpError(400, "图片名称需要 1～150 个字符");
  return name.trim();
}
const imageSummary = ({
  id,
  name,
  locked,
  revision,
  createdAt,
  updatedAt,
  labels,
}) => ({
  id,
  name,
  locked,
  revision,
  createdAt,
  updatedAt,
  labelCount: labels.length,
});
const gallerySummary = (gallery) => ({
  schemaVersion: 4,
  revision: gallery.revision,
  activeImageId: gallery.activeImageId,
  images: gallery.images.map(imageSummary),
  updatedAt: gallery.updatedAt,
});

export function createStore(dataDir) {
  const root = path.resolve(dataDir),
    metadataPath = path.join(root, "gallery.json");
  const svgDir = path.join(root, "gallery-svg");
  let loaded,
    queue = Promise.resolve();
  async function saveSvg(svg) {
    const hash = createHash("sha256").update(svg.content).digest("hex");
    const file = path.join(svgDir, `${hash}.svg`);
    await fs.mkdir(svgDir, { recursive: true });
    try {
      await fs.access(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const temporary = `${file}.${randomUUID()}.tmp`;
      const handle = await fs.open(temporary, "wx");
      try {
        await handle.writeFile(svg.content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, file);
    }
    return { name: svg.name, hash };
  }
  async function initialize() {
    await fs.mkdir(root, { recursive: true });
    try {
      const gallery = await readJSON(metadataPath);
      if (gallery.schemaVersion !== 4) throw new Error("不支持的图片库版本");
      // Existing galleries predate label locking; keep those images editable.
      gallery.images = gallery.images.map((image) => ({
        ...image,
        locked: image.locked === true,
      }));
      return gallery;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Read the previous document once. Keep all legacy files untouched as a backup.
    let old;
    try {
      old = await readJSON(path.join(root, "content.json"));
      if (![2, 3].includes(old.schemaVersion))
        throw new Error("不支持的旧版内容版本");
      if (old.svg)
        old = {
          ...old,
          svg: {
            name: old.svg.name,
            content: await fs.readFile(
              path.join(root, "svg", `${old.svg.hash}.svg`),
              "utf8",
            ),
          },
        };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // A missing referenced SVG is an error; it must not silently create an empty gallery.
      if (old) throw error;
      old = await readLegacy(root);
    }
    const now = new Date().toISOString();
    const image = old?.svg
      ? {
          id: randomUUID(),
          name: validateName(
            old.svg.name.replace(/\.svg$/i, "") || old.svg.name,
          ),
          revision: 1,
          locked: false,
          svg: await saveSvg(validateFile(old.svg)),
          labels: validateLabels(old.labels || []),
          createdAt: old.updatedAt || now,
          updatedAt: now,
        }
      : null;
    const gallery = {
      schemaVersion: 4,
      revision: 1,
      activeImageId: image?.id || null,
      images: image ? [image] : [],
      updatedAt: now,
    };
    await atomicJSON(metadataPath, gallery);
    return gallery;
  }
  const metadata = () =>
    (loaded ||= initialize().catch((error) => {
      loaded = null;
      throw error;
    }));
  const exclusive = (work) => {
    const operation = queue.catch(() => {}).then(work);
    queue = operation;
    return operation;
  };
  const find = (gallery, id) => {
    const image = validId(id) && gallery.images.find((item) => item.id === id);
    if (!image)
      throw new HttpError(404, "这张图片已被删除或不存在，请刷新图片列表");
    return image;
  };
  const expand = async (image) => ({
    ...image,
    svg: {
      name: image.svg.name,
      content: await fs.readFile(
        path.join(svgDir, `${image.svg.hash}.svg`),
        "utf8",
      ),
    },
  });
  const checkRevision = (image, input) => {
    if (input?.revision !== image.revision)
      throw new HttpError(
        409,
        "这张图片已在其他页面更新，本页修改暂未保存。请保留标签文字后刷新，再继续编辑。",
      );
  };
  async function commit(old, patch) {
    const next = {
      ...old,
      ...patch,
      revision: old.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await atomicJSON(metadataPath, next);
    loaded = Promise.resolve(next);
    return next;
  }
  return {
    async list() {
      return gallerySummary(await metadata());
    },
    async read(id) {
      return expand(find(await metadata(), id));
    },
    create(input) {
      return exclusive(async () => {
        const old = await metadata(),
          svg = validateFile(input?.svg);
        const name = validateName(
          input?.name ??
            (svg.name.replace(/\.svg$/i, "").trim() || "未命名图片"),
        );
        const labels = validateLabels(input?.labels ?? []),
          now = new Date().toISOString();
        const image = {
          id: randomUUID(),
          name,
          revision: 1,
          locked: false,
          svg: await saveSvg(svg),
          labels,
          createdAt: now,
          updatedAt: now,
        };
        const next = await commit(old, {
          images: [image, ...old.images],
          activeImageId: image.id,
        });
        return { gallery: gallerySummary(next), image: { ...image, svg } };
      });
    },
    open(id) {
      return exclusive(async () => {
        const old = await metadata(),
          image = await expand(find(old, id));
        const next =
          old.activeImageId === id
            ? old
            : await commit(old, { activeImageId: id });
        return { gallery: gallerySummary(next), image };
      });
    },
    save(id, input) {
      return exclusive(async () => {
        const old = await metadata(),
          image = find(old, id);
        checkRevision(image, input);
        if (
          Object.keys(input).some(
            (key) => !["revision", "name", "labels", "locked"].includes(key),
          )
        )
          throw new HttpError(400, "仅支持修改图片名称、标签和锁定状态");
        if (Object.hasOwn(input, "locked") && typeof input.locked !== "boolean")
          throw new HttpError(400, "图片锁定状态需要为布尔值");
        // Unlock separately before changing labels, including from stale pages.
        if (image.locked && Object.hasOwn(input, "labels"))
          throw new HttpError(409, "图片已锁定，请先解锁图片再修改标签");
        const updated = {
          ...image,
          locked: input.locked ?? image.locked,
          name: Object.hasOwn(input, "name")
            ? validateName(input.name)
            : image.name,
          labels: Object.hasOwn(input, "labels")
            ? validateLabels(input.labels)
            : image.labels,
          revision: image.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        const next = await commit(old, {
          images: old.images.map((item) => (item.id === id ? updated : item)),
        });
        return { image: imageSummary(updated), gallery: gallerySummary(next) };
      });
    },
    remove(id, input) {
      return exclusive(async () => {
        const old = await metadata(),
          image = find(old, id);
        checkRevision(image, input);
        const images = old.images.filter((item) => item.id !== id);
        const next = await commit(old, {
          images,
          activeImageId:
            old.activeImageId === id
              ? images[0]?.id || null
              : old.activeImageId,
        });
        // Identical SVG bytes may be shared by several independently labelled images.
        if (!images.some((item) => item.svg.hash === image.svg.hash)) {
          try {
            await fs.unlink(path.join(svgDir, `${image.svg.hash}.svg`));
          } catch (error) {
            if (error.code !== "ENOENT")
              console.error("无法清理已删除的 SVG 文件", error);
          }
        }
        return { gallery: gallerySummary(next) };
      });
    },
  };
}
