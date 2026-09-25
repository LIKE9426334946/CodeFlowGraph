import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (message) => {
  throw new HttpError(400, message);
};
const string = (v, max, field) =>
  typeof v === "string" && v.length <= max
    ? v
    : fail(`${field} 格式无效或超过限制`);
const number = (v, min, max, field) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fail(`${field} 数值无效`);
const integer = (v, min, max, field) =>
  Number.isInteger(v)
    ? number(v, min, max, field)
    : fail(`${field} 必须为整数`);
export const validId = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
export function fileName(v, extension) {
  string(v, 150, "文件名");
  if (
    !v.trim() ||
    /[/\\\x00-\x1f]/.test(v) ||
    v.startsWith(".") ||
    !v.toLowerCase().endsWith(extension)
  )
    fail(`请选择有效的 ${extension} 文件名`);
  return v;
}
export function validateProject(input) {
  if (!input || typeof input !== "object") fail("项目格式无效");
  const name = string(input.name, 150, "项目名称").trim();
  if (!name) fail("请输入项目名称");
  if (
    !Array.isArray(input.files) ||
    input.files.length < 1 ||
    input.files.length > 64
  )
    fail("每个项目需要 1–64 个 Python 文件");
  const ids = new Set(),
    names = new Set();
  const files = input.files.map((f) => {
    if (!f || !validId(f.id) || ids.has(f.id)) fail("代码文件 ID 无效或重复");
    const name = fileName(f.name, ".py");
    if (names.has(name.toLowerCase())) fail("代码文件名不能重复");
    ids.add(f.id);
    names.add(name.toLowerCase());
    return {
      id: f.id,
      name,
      content: string(f.content, 2_000_000, "代码文件"),
    };
  });
  let svg = null;
  if (input.svg) {
    svg = {
      name: fileName(input.svg.name, ".svg"),
      content: string(input.svg.content, 30_000_000, "SVG"),
    };
    if (!/<svg[\s>]/i.test(svg.content)) fail("文件中没有 SVG 根元素");
  }
  if (!Array.isArray(input.bindings) || input.bindings.length > 5000)
    fail("绑定数量超过限制");
  const bindingIds = new Set();
  const bindings = input.bindings.map((b) => {
    if (!b || !validId(b.id) || bindingIds.has(b.id))
      fail("绑定 ID 无效或重复");
    bindingIds.add(b.id);
    const file = files.find((f) => f.name === b.code?.file);
    if (!file) fail("绑定引用的代码文件不存在");
    const lines = file.content.split("\n").length;
    const startLine = integer(b.code.startLine, 1, lines, "起始行");
    const endLine = integer(b.code.endLine, startLine, lines, "结束行");
    const r = b.svgRegion;
    if (!r) fail("缺少 SVG 区域");
    const region = {
      x: number(r.x, -1e8, 1e8, "X"),
      y: number(r.y, -1e8, 1e8, "Y"),
      width: number(r.width, 0.01, 1e8, "宽度"),
      height: number(r.height, 0.01, 1e8, "高度"),
    };
    const annotation = b.annotation
      ? {
          x: number(b.annotation.x, -1e8, 1e8, "注释 X"),
          y: number(b.annotation.y, -1e8, 1e8, "注释 Y"),
        }
      : undefined;
    return {
      id: b.id,
      name: string(b.name, 200, "绑定名称"),
      color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#8978ff",
      code: { file: file.name, startLine, endLine },
      svgRegion: region,
      note: string(b.note ?? "", 200_000, "备注"),
      ...(annotation ? { annotation } : {}),
    };
  });
  if (bindings.length && !svg) fail("有绑定时必须有 SVG");
  const u = input.ui || {};
  const editorViews = {};
  for (const f of files) {
    const v = u.editorViews?.[f.id];
    if (v)
      editorViews[f.id] = {
        anchor: integer(v.anchor, 0, f.content.length, "光标"),
        head: integer(v.head, 0, f.content.length, "光标"),
        scrollTop: number(v.scrollTop, 0, 1e9, "编辑器滚动"),
        scrollLeft: number(v.scrollLeft, 0, 1e9, "编辑器滚动"),
      };
  }
  const camera = u.camera
    ? {
        scale: number(u.camera.scale, 0.001, 8, "缩放"),
        centerX: number(u.camera.centerX, -1e9, 1e9, "视图 X"),
        centerY: number(u.camera.centerY, -1e9, 1e9, "视图 Y"),
      }
    : null;
  return {
    name,
    files,
    svg,
    bindings,
    ui: {
      activeFileId: ids.has(u.activeFileId) ? u.activeFileId : files[0].id,
      split: number(u.split ?? 46, 22, 78, "面板比例"),
      theme: u.theme === "light" ? "light" : "dark",
      showCode: !!u.showCode,
      camera,
      selectedBindingId: bindingIds.has(u.selectedBindingId)
        ? u.selectedBindingId
        : null,
      editorViews,
      portraitTab: u.portraitTab === "svg" ? "svg" : "code",
    },
  };
}
export const blankProject = (name) => ({
  name,
  files: [
    {
      id: randomUUID(),
      name: "model.py",
      content: "# 在此编写或上传 Python / PyTorch 模型代码\n",
    },
  ],
  svg: null,
  bindings: [],
  ui: {},
});

export function createStore(dataDir) {
  const root = path.resolve(dataDir);
  const locks = new Map();
  const projectPath = (id) => {
    if (!validId(id)) throw new HttpError(400, "项目 ID 无效");
    return path.join(root, "projects", id);
  };
  const json = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
  async function atomic(p, data) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${randomUUID()}.tmp`;
    const handle = await fs.open(tmp, "wx");
    try {
      await handle.writeFile(JSON.stringify(data, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, p);
  }
  function exclusive(id, fn) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    locks.set(id, next);
    return next.finally(() => {
      if (locks.get(id) === next) locks.delete(id);
    });
  }
  async function read(id) {
    try {
      const dir = projectPath(id);
      const pointer = await json(path.join(dir, "current.json"));
      const folder = path.join(dir, "versions", pointer.version);
      const metadata = await json(path.join(folder, "project.json"));
      const [bindings, files, svg] = await Promise.all([
        json(path.join(folder, "bindings.json")),
        Promise.all(
          metadata.files.map(async (f) => ({
            ...f,
            content: await fs.readFile(
              path.join(folder, "sources", `${f.id}.py`),
              "utf8",
            ),
          })),
        ),
        metadata.svg
          ? fs
              .readFile(path.join(folder, "network.svg"), "utf8")
              .then((content) => ({ ...metadata.svg, content }))
          : null,
      ]);
      return { ...metadata, bindings, files, svg };
    } catch (e) {
      if (e.code === "ENOENT") throw new HttpError(404, "项目不存在");
      throw e;
    }
  }
  async function write(id, input, old) {
    const data = validateProject(input);
    const revision = (old?.revision || 0) + 1;
    const version = `${revision}-${randomUUID()}`;
    const dir = projectPath(id);
    const folder = path.join(dir, "versions", version);
    const previous = old
      ? path.join(
          dir,
          "versions",
          (await json(path.join(dir, "current.json"))).version,
        )
      : null;
    await fs.mkdir(path.join(folder, "sources"), { recursive: true });
    const project = {
      ...data,
      id,
      revision,
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const metadata = {
      ...project,
      files: data.files.map(({ content, ...f }) => f),
      svg: data.svg ? { name: data.svg.name } : null,
    };
    delete metadata.bindings;
    const contentFile = async (relative, content, unchanged) => {
      const target = path.join(folder, relative);
      // Reuse immutable file bytes for camera/layout saves; do not duplicate a large SVG.
      if (previous && unchanged)
        await fs.link(path.join(previous, relative), target);
      else await fs.writeFile(target, content);
    };
    await Promise.all([
      atomic(path.join(folder, "project.json"), metadata),
      atomic(path.join(folder, "bindings.json"), data.bindings),
      ...data.files.map((f) =>
        contentFile(
          path.join("sources", `${f.id}.py`),
          f.content,
          old?.files.some((o) => o.id === f.id && o.content === f.content),
        ),
      ),
      ...(data.svg
        ? [
            contentFile(
              "network.svg",
              data.svg.content,
              old?.svg?.content === data.svg.content,
            ),
          ]
        : []),
    ]);
    // A single pointer rename publishes a complete snapshot. Keep the previous revision.
    await atomic(path.join(dir, "current.json"), { version, revision });
    const versions = await fs.readdir(path.join(dir, "versions"));
    await Promise.all(
      versions
        .filter((v) => Number(v.split("-")[0]) < revision - 1)
        .map((v) =>
          fs.rm(path.join(dir, "versions", v), {
            recursive: true,
            force: true,
          }),
        ),
    );
    return project;
  }
  async function list() {
    const dir = path.join(root, "projects");
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results = await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          try {
            const pointer = await json(path.join(dir, e.name, "current.json"));
            const folder = path.join(dir, e.name, "versions", pointer.version);
            const p = await json(path.join(folder, "project.json"));
            const bindings = await json(path.join(folder, "bindings.json"));
            return {
              id: p.id,
              name: p.name,
              revision: p.revision,
              updatedAt: p.updatedAt,
              fileCount: p.files.length,
              bindingCount: bindings.length,
            };
          } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
          }
        }),
    );
    return results
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return {
    read,
    list,
    create: (input) => {
      const id = randomUUID();
      return exclusive(id, () => write(id, input, null));
    },
    save: (id, input, partial = false) =>
      exclusive(id, async () => {
        const old = await read(id);
        if (input.revision !== old.revision)
          throw new HttpError(
            409,
            "此项目已在其他页面更新。请先导出本地副本，再重新加载项目。",
          );
        const patch = Object.fromEntries(
          ["name", "files", "svg", "bindings", "ui"]
            .filter((k) => Object.hasOwn(input, k))
            .map((k) => [k, input[k]]),
        );
        return write(id, partial ? { ...old, ...patch } : input, old);
      }),
    remove: (id) =>
      exclusive(id, async () => {
        await read(id);
        await fs.rm(projectPath(id), { recursive: true });
      }),
    workspace: async () => {
      try {
        return await json(path.join(root, "workspace.json"));
      } catch (e) {
        if (e.code === "ENOENT") return { activeProjectId: null };
        throw e;
      }
    },
    setWorkspace: (id) =>
      exclusive("workspace", async () => {
        if (id !== null) await read(id);
        await atomic(path.join(root, "workspace.json"), {
          activeProjectId: id,
        });
      }),
  };
}
