import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Image,
  Maximize,
  Minimize,
  Minus,
  Plus,
  Scan,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import type { Camera, SvgLabel, TextFile } from "../types";
import { clientToSvg, parseSvg, svgElement } from "../lib/svg";

type Controls = {
  zoom: (factor: number) => void;
  actual: () => void;
  fit: () => void;
};
type Editor = { label: SvgLabel; isNew: boolean };
type Point = { x: number; y: number };
type Gesture = {
  id: number;
  start: Point;
  moved: boolean;
} & (
  | { kind: "pan"; left: number; top: number }
  | { kind: "place" }
  | { kind: "label"; label: SvgLabel; anchor: DOMPoint; next: Point }
);
type Props = {
  svg: TextFile | null;
  labels: SvgLabel[];
  onLabelsChange: (labels: SvgLabel[]) => void;
  onEditingChange: (editing: boolean) => void;
  actions: ReactNode;
  admin: boolean;
  onUpload: () => void;
};

export function SvgViewer({
  svg,
  labels,
  onLabelsChange,
  onEditingChange,
  actions,
  admin,
  onUpload,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLButtonElement>(null),
    controls = useRef<Controls | null>(null);
  const redraw = useRef<(() => void) | null>(null);
  const [error, setError] = useState(""),
    [placing, setPlacing] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null),
    [fullscreen, setFullscreen] = useState(false);
  const latest = useRef({
    labels,
    onLabelsChange,
    onEditingChange,
    placing,
    editor,
  });
  latest.current = { labels, onLabelsChange, onEditingChange, placing, editor };
  useEffect(() => {
    onEditingChange(placing || !!editor);
    redraw.current?.();
  }, [labels, placing, editor, onEditingChange]);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacing(false);
        setEditor(null);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    const view = viewport.current,
      host = surface.current;
    setEditor(null);
    setPlacing(false);
    setError("");
    if (!svg || !view || !host) return;
    let parsed;
    try {
      parsed = parseSvg(svg.content);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const { bounds, svg: original } = parsed;
    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
    shadow.replaceChildren();
    // One transform moves the drawing and labels together. Uploaded SVG CSS is
    // isolated in its own ShadowRoot so rules such as `text { ... }` cannot alter labels.
    const scene = document.createElement("div");
    scene.style.cssText = `position:absolute;transform-origin:0 0;width:${bounds.width}px;height:${bounds.height}px;background:white;box-shadow:0 4px 24px #26304312;`;
    const picture = document.createElement("div");
    picture.style.cssText = "position:absolute;inset:0;pointer-events:none";
    const drawing = svgElement("svg", {
      id: "display-svg",
      viewBox: `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
      width: bounds.width,
      height: bounds.height,
    });
    drawing.style.cssText = "display:block;overflow:visible";
    drawing.append(original);
    picture.attachShadow({ mode: "open" }).append(drawing);
    const overlay = svgElement("svg", {
      id: "label-overlay",
      viewBox: drawing.getAttribute("viewBox")!,
      width: bounds.width,
      height: bounds.height,
      "aria-label": "图片标签",
    });
    overlay.style.cssText =
      "position:absolute;inset:0;display:block;overflow:visible";
    scene.append(picture, overlay);
    shadow.append(scene);
    const groups = new Map<string, SVGGElement>();
    const measure = document.createElement("canvas").getContext("2d");
    const renderLabels = () => {
      const state = latest.current;
      const fontFamily = getComputedStyle(host).fontFamily;
      const visible = state.editor?.isNew
        ? [
            ...state.labels,
            {
              ...state.editor.label,
              text: state.editor.label.text || "输入标签",
            },
          ]
        : state.labels;
      const ids = new Set(visible.map((label) => label.id));
      for (const [id, group] of groups)
        if (!ids.has(id)) {
          group.remove();
          groups.delete(id);
        }
      for (const label of visible) {
        let group = groups.get(label.id);
        if (!group) {
          group = svgElement("g", {
            "data-label-id": label.id,
            role: "button",
            tabindex: 0,
          });
          group.style.cssText = "cursor:move;outline:none";
          overlay.append(group);
          groups.set(label.id, group);
        }
        const f = label.fontSize,
          pad = f * 0.65;
        if (measure) measure.font = `${f}px ${fontFamily}`;
        const widthOf = (text: string) =>
          measure?.measureText(text).width ?? [...text].length * f;
        const lines: string[] = [];
        for (const paragraph of label.text.split(/\r?\n/)) {
          let line = "";
          for (const character of paragraph) {
            if (line && widthOf(line + character) > f * 22) {
              lines.push(line);
              line = "";
            }
            line += character;
          }
          lines.push(line);
        }
        const width = Math.max(f * 2, ...lines.map(widthOf)) + pad * 2;
        const height = Math.max(f * 2.45, lines.length * f * 1.4 + pad * 2);
        const selected = state.editor?.label.id === label.id;
        const rect = svgElement("rect", {
          width,
          height,
          rx: f * 0.35,
          fill: selected ? "#fff0b8" : "#fff9df",
          stroke: selected ? "#bc851b" : "#dac585",
          "stroke-width": f * 0.07,
        });
        const text = svgElement("text", {
          fill: "#51401b",
          "font-family": fontFamily,
          "font-size": f,
        });
        text.style.userSelect = "none";
        lines.forEach((line, i) => {
          const span = svgElement("tspan", {
            x: pad,
            y: pad + f * (1.05 + i * 1.4),
          });
          span.textContent = line;
          text.append(span);
        });
        group.setAttribute("transform", `translate(${label.x} ${label.y})`);
        group.setAttribute("aria-label", `标签：${label.text}`);
        group.replaceChildren(rect, text);
      }
    };
    redraw.current = renderLabels;
    renderLabels();
    document.fonts.addEventListener("loadingdone", renderLabels);
    let scale = 1,
      offsetX = 0,
      autoFit = true,
      frame = 0;
    let camera: Camera | null = null;
    const clampScale = (value: number) => Math.max(0.001, Math.min(8, value));
    const readCamera = (): Camera => ({
      scale,
      centerX:
        bounds.x + (view.scrollLeft + view.clientWidth / 2 - offsetX) / scale,
      centerY: bounds.y + (view.scrollTop + view.clientHeight / 2) / scale,
    });
    const position = (next: Camera) => {
      if (!view.clientWidth || !view.clientHeight) return;
      scale = clampScale(next.scale);
      offsetX = view.clientWidth;
      host.style.width = `${bounds.width * scale + offsetX * 2}px`;
      // Vertical scrolling stops at the drawing edges, without canvas padding.
      host.style.height = `${bounds.height * scale}px`;
      scene.style.left = `${offsetX}px`;
      scene.style.top = "0";
      scene.style.transform = `scale(${scale})`;
      view.scrollLeft =
        (next.centerX - bounds.x) * scale + offsetX - view.clientWidth / 2;
      view.scrollTop =
        (next.centerY - bounds.y) * scale - view.clientHeight / 2;
      if (percent.current)
        percent.current.textContent = `${(scale * 100).toFixed(scale < 0.1 ? 1 : 0)}%`;
      camera = readCamera();
    };
    const fit = () => {
      autoFit = true;
      const k = clampScale((view.clientWidth - 48) / bounds.width);
      position({
        scale: k,
        centerX: bounds.x + bounds.width / 2,
        centerY: bounds.y + view.clientHeight / (2 * k),
      });
    };
    const zoomAt = (next: number, x: number, y: number) => {
      autoFit = false;
      const p = clientToSvg(overlay, x, y),
        box = view.getBoundingClientRect(),
        k = clampScale(next);
      position({
        scale: k,
        centerX: p.x - (x - box.left - view.clientWidth / 2) / k,
        centerY: p.y - (y - box.top - view.clientHeight / 2) / k,
      });
    };
    controls.current = {
      fit,
      actual: () => {
        autoFit = false;
        position({ ...readCamera(), scale: 1 });
      },
      zoom: (factor) => {
        autoFit = false;
        position({ ...readCamera(), scale: scale * factor });
      },
    };
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(
          scale * Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002),
          e.clientX,
          e.clientY,
        );
      }
    };
    const pointers = new Map<number, Point>();
    let gesture: Gesture | null = null;
    let pinch: { distance: number; scale: number; anchor: DOMPoint } | null =
      null;
    let moveEvent: PointerEvent | null = null;
    const labelAt = (e: Event) => {
      const element = e
        .composedPath()
        .find(
          (node) =>
            node instanceof Element && node.hasAttribute("data-label-id"),
        ) as Element | undefined;
      const id = element?.getAttribute("data-label-id");
      return (
        latest.current.labels.find((label) => label.id === id) ||
        (latest.current.editor?.isNew && latest.current.editor.label.id === id
          ? latest.current.editor.label
          : undefined)
      );
    };
    const midpoint = () => {
      const [a, b] = [...pointers.values()];
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      };
    };
    const start = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      const box = view.getBoundingClientRect();
      if (
        e.clientX - box.left >= view.clientWidth ||
        e.clientY - box.top >= view.clientHeight
      )
        return;
      e.preventDefault();
      view.focus({ preventScroll: true });
      view.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      latest.current.onEditingChange(true);
      if (pointers.size === 1) {
        const label = labelAt(e);
        const base = {
          id: e.pointerId,
          start: { x: e.clientX, y: e.clientY },
          moved: false,
        };
        if (latest.current.placing && e.button === 0)
          gesture = { ...base, kind: "place" };
        else if (label && e.button === 0)
          gesture = {
            ...base,
            kind: "label",
            label: { ...label },
            next: { x: label.x, y: label.y },
            anchor: clientToSvg(overlay, e.clientX, e.clientY),
          };
        else
          gesture = {
            ...base,
            kind: "pan",
            left: view.scrollLeft,
            top: view.scrollTop,
          };
        view.classList.add("dragging");
      } else if (pointers.size === 2) {
        // A second finger changes the whole gesture to pinch; discard any label drag.
        renderLabels();
        gesture = null;
        const p = midpoint();
        pinch = {
          distance: p.distance,
          scale,
          anchor: clientToSvg(overlay, p.x, p.y),
        };
      }
    };
    const applyMove = (e: PointerEvent) => {
      if (pinch && pointers.size >= 2) {
        autoFit = false;
        const p = midpoint(),
          box = view.getBoundingClientRect(),
          k = clampScale((pinch.scale * p.distance) / pinch.distance);
        position({
          scale: k,
          centerX: pinch.anchor.x - (p.x - box.left - view.clientWidth / 2) / k,
          centerY: pinch.anchor.y - (p.y - box.top - view.clientHeight / 2) / k,
        });
      } else if (gesture?.id === e.pointerId) {
        const dx = e.clientX - gesture.start.x,
          dy = e.clientY - gesture.start.y;
        gesture.moved ||= Math.hypot(dx, dy) > 5;
        if (!gesture.moved) return;
        if (gesture.kind === "pan") {
          view.scrollLeft = gesture.left - dx;
          view.scrollTop = gesture.top - dy;
          camera = readCamera();
        } else if (gesture.kind === "label") {
          const p = clientToSvg(overlay, e.clientX, e.clientY);
          gesture.next = {
            x: Math.max(
              bounds.x,
              Math.min(
                bounds.x + bounds.width,
                gesture.label.x + p.x - gesture.anchor.x,
              ),
            ),
            y: Math.max(
              bounds.y,
              Math.min(
                bounds.y + bounds.height,
                gesture.label.y + p.y - gesture.anchor.y,
              ),
            ),
          };
          groups
            .get(gesture.label.id)
            ?.setAttribute(
              "transform",
              `translate(${gesture.next.x} ${gesture.next.y})`,
            );
        }
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moveEvent = e;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (moveEvent) applyMove(moveEvent);
          moveEvent = null;
        });
    };
    const end = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      cancelAnimationFrame(frame);
      frame = 0;
      const cancelled = e.type !== "pointerup";
      if (moveEvent) applyMove(moveEvent);
      moveEvent = null;
      if (!cancelled && gesture?.id === e.pointerId) applyMove(e);
      let opensEditor = false;
      if (!cancelled && gesture?.id === e.pointerId) {
        if (gesture.kind === "label") {
          const { label, moved, next } = gesture;
          if (moved) {
            if (
              latest.current.editor?.isNew &&
              latest.current.editor.label.id === label.id
            )
              setEditor((old) =>
                old ? { ...old, label: { ...old.label, ...next } } : old,
              );
            else
              latest.current.onLabelsChange(
                latest.current.labels.map((l) =>
                  l.id === label.id ? { ...l, ...next } : l,
                ),
              );
          } else if (!latest.current.editor?.isNew) {
            setEditor({ label, isNew: false });
            opensEditor = true;
          }
        } else if (gesture.kind === "place" && !gesture.moved) {
          const point = clientToSvg(overlay, e.clientX, e.clientY);
          if (
            point.x >= bounds.x &&
            point.x <= bounds.x + bounds.width &&
            point.y >= bounds.y &&
            point.y <= bounds.y + bounds.height
          ) {
            // randomUUID is unavailable on plain HTTP IP addresses in some browsers.
            const id =
              globalThis.crypto?.randomUUID?.() ??
              `label_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
            setEditor({
              isNew: true,
              label: {
                id,
                text: "",
                x: point.x,
                y: point.y,
                fontSize: 18 / scale,
              },
            });
            setPlacing(false);
            opensEditor = true;
          }
        }
      } else renderLabels();
      pointers.delete(e.pointerId);
      if (view.hasPointerCapture(e.pointerId))
        view.releasePointerCapture(e.pointerId);
      pinch = null;
      gesture = null;
      const rest = [...pointers][0];
      if (rest)
        gesture = {
          id: rest[0],
          kind: "pan",
          start: rest[1],
          moved: false,
          left: view.scrollLeft,
          top: view.scrollTop,
        };
      if (!pointers.size) {
        view.classList.remove("dragging");
        latest.current.onEditingChange(
          opensEditor || !!latest.current.editor || latest.current.placing,
        );
      }
    };
    const key = (e: KeyboardEvent) => {
      const label = labelAt(e);
      if (label && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setEditor({ label: { ...label }, isNew: false });
      }
    };
    const scroll = () => {
      if (view.clientWidth && view.clientHeight) camera = readCamera();
    };
    const resize = new ResizeObserver(() => {
      if (!view.clientWidth || !view.clientHeight) return;
      if (autoFit || !camera) fit();
      else position(camera);
    });
    view.addEventListener("wheel", wheel, { passive: false });
    view.addEventListener("pointerdown", start);
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    view.addEventListener("lostpointercapture", end);
    view.addEventListener("keydown", key);
    view.addEventListener("scroll", scroll, { passive: true });
    resize.observe(view);
    fit();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.current = null;
      redraw.current = null;
      document.fonts.removeEventListener("loadingdone", renderLabels);
      view.removeEventListener("wheel", wheel);
      view.removeEventListener("pointerdown", start);
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerup", end);
      view.removeEventListener("pointercancel", end);
      view.removeEventListener("lostpointercapture", end);
      view.removeEventListener("keydown", key);
      view.removeEventListener("scroll", scroll);
      shadow.replaceChildren();
      view.classList.remove("dragging");
      latest.current.onEditingChange(false);
    };
  }, [svg?.content]);
  const saveLabel = () => {
    if (!editor?.label.text.trim()) return;
    const label = { ...editor.label, text: editor.label.text.trim() };
    if (editor.isNew) onLabelsChange([...labels, label]);
    else
      onLabelsChange(
        labels.map((old) =>
          old.id === label.id ? { ...old, text: label.text } : old,
        ),
      );
    setEditor(null);
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("此浏览器不支持全屏操作");
    }
  };
  return (
    <main className="svg-viewer">
      <aside className="viewer-tools" aria-label="图片工具栏">
        <a
          className="brand"
          href={admin ? "/admin" : "/"}
          title="CodeFlowGraph"
        >
          <Image size={21} />
          <strong>CodeFlowGraph</strong>
        </a>
        <span className="file-name" title={svg?.name}>
          {admin ? "图片管理" : svg?.name || "SVG 图片"}
        </span>
        <button
          className={`button add-label ${placing ? "active" : ""}`}
          disabled={!svg || labels.length >= 1000}
          aria-pressed={placing}
          aria-label={placing ? "取消添加" : "添加标签"}
          title={placing ? "取消添加" : "添加标签"}
          onClick={() => {
            setEditor(null);
            setPlacing(!placing);
          }}
        >
          <Tag size={17} />
          <span>{placing ? "取消添加" : "添加标签"}</span>
        </button>
        <div className="tool-divider" />
        <div className="zoom-controls" aria-label="缩放控制">
          <button
            className="icon-button"
            disabled={!svg}
            aria-label="缩小图片"
            title="缩小图片"
            onClick={() => controls.current?.zoom(1 / 1.2)}
          >
            <Minus size={18} />
          </button>
          <button
            className="zoom-label"
            disabled={!svg}
            ref={percent}
            title="恢复 100%"
            aria-label="恢复 100%"
            onClick={() => controls.current?.actual()}
          >
            100%
          </button>
          <button
            className="icon-button"
            disabled={!svg}
            aria-label="放大图片"
            title="放大图片"
            onClick={() => controls.current?.zoom(1.2)}
          >
            <Plus size={18} />
          </button>
        </div>
        <button
          className="button fit-button"
          disabled={!svg}
          aria-label="适应宽度"
          title="适应宽度"
          onClick={() => controls.current?.fit()}
        >
          <Scan size={17} />
          <span>适应宽度</span>
        </button>
        {document.fullscreenEnabled && (
          <button
            className="button fullscreen-button"
            aria-label={fullscreen ? "退出浏览器全屏" : "进入浏览器全屏"}
            title={fullscreen ? "退出浏览器全屏" : "进入浏览器全屏"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            <span>{fullscreen ? "退出全屏" : "浏览器全屏"}</span>
          </button>
        )}
        <div className="toolbar-actions">{actions}</div>
      </aside>
      <div className="viewer-canvas">
        {svg ? (
          <div
            ref={viewport}
            className={`svg-viewport ${placing ? "placing" : ""}`}
            tabIndex={0}
            aria-label="SVG 查看区域"
          >
            <div ref={surface} className="svg-surface" />
          </div>
        ) : (
          <div className="empty-svg">
            <Image size={46} strokeWidth={1.2} />
            <p>上传一张 SVG，开始标注</p>
            {admin ? (
              <button className="button" onClick={onUpload}>
                上传 SVG
              </button>
            ) : (
              <a className="button" href="/admin">
                前往管理页上传
              </a>
            )}
          </div>
        )}
        {placing && (
          <div className="placement-hint" role="status">
            点击图片中的位置，输入标签文字
            <button
              className="icon-button"
              aria-label="取消添加标签"
              onClick={() => setPlacing(false)}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {error && (
          <div className="viewer-error" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setError("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {editor && (
          <form
            className="label-editor"
            aria-label={editor.isNew ? "添加标签" : "编辑标签"}
            onSubmit={(e) => {
              e.preventDefault();
              saveLabel();
            }}
          >
            <div className="editor-heading">
              <label htmlFor="label-text">
                {editor.isNew ? "添加标签" : "编辑标签"}
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label="取消编辑标签"
                onClick={() => setEditor(null)}
              >
                <X size={17} />
              </button>
            </div>
            <textarea
              id="label-text"
              aria-label="标签文字"
              value={editor.label.text}
              autoFocus
              maxLength={1000}
              rows={3}
              placeholder="输入标签文字…"
              onChange={(e) =>
                setEditor({
                  ...editor,
                  label: { ...editor.label, text: e.target.value },
                })
              }
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  saveLabel();
                }
              }}
            />
            <div className="editor-actions">
              {!editor.isNew && (
                <button
                  type="button"
                  className="button delete-label"
                  onClick={() => {
                    onLabelsChange(
                      labels.filter((label) => label.id !== editor.label.id),
                    );
                    setEditor(null);
                  }}
                >
                  <Trash2 size={16} />
                  删除
                </button>
              )}
              <span>拖动标签可调整位置</span>
              <button
                type="submit"
                className="button primary"
                disabled={!editor.label.text.trim()}
              >
                保存标签
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
