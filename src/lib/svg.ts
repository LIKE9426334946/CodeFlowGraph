import DOMPurify from "dompurify";
import type { Rect } from "../types";
const NS = "http://www.w3.org/2000/svg";
export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
) {
  const e = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes))
    e.setAttribute(key, String(value));
  return e;
}
export function parseSvg(content: string): {
  svg: SVGSVGElement;
  bounds: Rect;
} {
  const doc = new DOMParser().parseFromString(content, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    throw new Error("SVG 文件格式无效，请重新导出后上传");
  const clean = DOMPurify.sanitize(
    new XMLSerializer().serializeToString(doc.documentElement),
    {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ["style"],
      FORBID_TAGS: [
        "script",
        "foreignObject",
        "iframe",
        "object",
        "embed",
        "animate",
        "set",
        "animateTransform",
        "animateMotion",
        "a",
      ],
      RETURN_DOM: false,
    },
  );
  const parsed = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svg = document.importNode(
    parsed.documentElement,
    true,
  ) as unknown as SVGSVGElement;
  if (svg.localName !== "svg") throw new Error("无法读取 SVG 内容");
  // Uploaded CSS lives in a ShadowRoot; remove remote resources as well.
  for (const e of [svg, ...svg.querySelectorAll("*")]) {
    for (const a of [...e.attributes]) {
      if (
        /^on/i.test(a.name) ||
        (/^(href|xlink:href)$/i.test(a.name) &&
          !a.value.startsWith("#") &&
          !/^data:image\/(png|jpeg|webp);base64,/i.test(a.value))
      )
        e.removeAttribute(a.name);
      if (
        /url\s*\(/i.test(a.value) &&
        /url\s*\(\s*['"]?(?!#)/i.test(
          a.value.replace(/url\s*\(\s*['"]?#/gi, "LOCAL("),
        )
      )
        e.removeAttribute(a.name);
    }
    if (e.localName === "style") {
      let css = e.textContent || "";
      css = css
        .replace(/@import[^;]*(;|$)/gi, "")
        .replace(/@font-face\s*\{[^}]*\}/gi, "");
      if (
        /\\|url\s*\(\s*['"]?(?:https?:|\/\/|data:)|:host|::slotted|@import/i.test(
          css,
        )
      )
        css = "";
      e.textContent = css;
    }
  }
  const parts = (svg.getAttribute("viewBox") || "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  let bounds: Rect;
  if (
    parts.length === 4 &&
    parts.every(Number.isFinite) &&
    parts[2] > 0 &&
    parts[3] > 0
  )
    bounds = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  else {
    const w = Number.parseFloat(svg.getAttribute("width") || ""),
      h = Number.parseFloat(svg.getAttribute("height") || "");
    if (!(w > 0 && h > 0))
      throw new Error("SVG 需要有效的 viewBox 或 width / height");
    bounds = { x: 0, y: 0, width: w, height: h };
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  if (
    Math.max(
      Math.abs(bounds.x),
      Math.abs(bounds.y),
      bounds.width,
      bounds.height,
    ) > 1e8
  )
    throw new Error("SVG 尺寸超出支持范围");
  svg.setAttribute("x", String(bounds.x));
  svg.setAttribute("y", String(bounds.y));
  svg.setAttribute("width", String(bounds.width));
  svg.setAttribute("height", String(bounds.height));
  svg.removeAttribute("style");
  svg.style.pointerEvents = "none";
  return { svg, bounds };
}
export function clientToSvg(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
) {
  const matrix = svg.getScreenCTM();
  if (!matrix) throw new Error("SVG 尚未显示");
  return new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
}
export function rectFromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
