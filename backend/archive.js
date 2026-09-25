import JSZip from "jszip";
import { HttpError, validateProject, fileName } from "./store.js";

export async function exportProject(project) {
  const zip = new JSZip();
  const metadata = {
    format: "CodeFlowGraph",
    formatVersion: 1,
    name: project.name,
    files: project.files.map(({ content, ...file }) => file),
    svg: project.svg ? { name: project.svg.name } : null,
    ui: project.ui,
  };
  zip.file("project.json", JSON.stringify(metadata, null, 2));
  zip.file("bindings.json", JSON.stringify(project.bindings, null, 2));
  for (const f of project.files) zip.file(f.name, f.content);
  if (project.svg) zip.file(project.svg.name, project.svg.content);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
export async function importProject(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new HttpError(400, "无法读取 ZIP 项目文件");
  }
  const entries = Object.values(zip.files);
  if (
    entries.length > 100 ||
    entries.some((f) => f.unsafeOriginalName && f.unsafeOriginalName !== f.name)
  )
    throw new HttpError(400, "ZIP 路径或文件数量无效");
  const total = entries.reduce(
    (sum, file) => sum + (file._data?.uncompressedSize || 0),
    0,
  );
  if (
    total > 80_000_000 ||
    entries.some((f) => (f._data?.uncompressedSize || 0) > 32_000_000)
  )
    throw new HttpError(413, "ZIP 解压后超过大小限制");
  const text = async (name) => {
    const f = zip.file(name);
    if (!f) throw new HttpError(400, `ZIP 缺少 ${name}`);
    return f.async("string");
  };
  try {
    const metadata = JSON.parse(await text("project.json"));
    if (
      metadata.format !== "CodeFlowGraph" ||
      metadata.formatVersion !== 1 ||
      !Array.isArray(metadata.files)
    )
      throw new Error("Unsupported project format");
    const files = await Promise.all(
      metadata.files.map(async (f) => ({
        id: f.id,
        name: fileName(f.name, ".py"),
        content: await text(fileName(f.name, ".py")),
      })),
    );
    const svg = metadata.svg
      ? {
          name: fileName(metadata.svg.name, ".svg"),
          content: await text(fileName(metadata.svg.name, ".svg")),
        }
      : null;
    const bindings = JSON.parse(await text("bindings.json"));
    return validateProject({ ...metadata, files, svg, bindings });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(
      400,
      "项目文件结构无效，请导入 CodeFlowGraph 导出的 ZIP",
    );
  }
}
