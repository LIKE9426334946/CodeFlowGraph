import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { FileImage, Move, ScanLine } from "lucide-react";
import type { Binding, Camera, Project, Rect } from "../types";
import {
  clientToSvg,
  parseSvg,
  rectFromPoints,
  svgElement,
  unionRect,
} from "../lib/svg";

export type SvgTextResult = { text: string; rect: Rect };
export type SvgViewerHandle = {
  zoom: (factor: number) => void;
  fit: (mode?: "window" | "width" | "actual") => void;
  focus: (r: Rect) => void;
  search: (query: string) => SvgTextResult[];
  camera: () => Camera | null;
};
type Props = {
  svg: Project["svg"];
  bindings: Binding[];
  files: Project["files"];
  selectedId: string | null;
  showCode: boolean;
  camera: Camera | null;
  selecting: boolean;
  onRegion: (r: Rect) => void;
  onActivate: (id: string) => void;
  onCamera: (camera: Camera) => void;
  onScale: (scale: number) => void;
  onUpload: () => void;
  onError: (error: string) => void;
  onCancel: () => void;
};
type Runtime = {
  scene: SVGSVGElement;
  original: SVGSVGElement;
  overlay: SVGGElement;
  preview: SVGGElement;
  base: Rect;
  bounds: Rect;
  scale: number;
  offset: { x: number; y: number };
  position: (camera: Camera, emit?: boolean) => void;
  getCamera: () => Camera;
  fit: (mode: "window" | "width" | "actual") => void;
  focus: (r: Rect) => void;
  dispose: () => void;
  texts: SvgTextResult[] | null;
};
export const SvgViewer = forwardRef<SvgViewerHandle, Props>(
  function SvgViewer(props, ref) {
    const viewport = useRef<HTMLDivElement>(null),
      surface = useRef<HTMLDivElement>(null),
      runtime = useRef<Runtime | null>(null),
      latest = useRef(props);
    const [error, setError] = useState("");
    latest.current = props;
    useImperativeHandle(
      ref,
      () => ({
        zoom(factor) {
          const rt = runtime.current;
          if (rt) {
            const c = rt.getCamera();
            rt.position({
              ...c,
              scale: Math.max(0.001, Math.min(8, c.scale * factor)),
            });
          }
        },
        fit(mode = "window") {
          runtime.current?.fit(mode);
        },
        focus(r) {
          runtime.current?.focus(r);
        },
        camera() {
          return runtime.current?.getCamera() || null;
        },
        search(query) {
          const rt = runtime.current;
          if (!rt) return [];
          if (!rt.texts) {
            rt.texts = [];
            for (const element of rt.original.querySelectorAll("text")) {
              const text = element.textContent?.trim();
              if (!text) continue;
              try {
                const box = element.getBBox();
                const m = rt.scene
                  .getScreenCTM()!
                  .inverse()
                  .multiply(element.getScreenCTM()!);
                const corners = [
                  [box.x, box.y],
                  [box.x + box.width, box.y],
                  [box.x, box.y + box.height],
                  [box.x + box.width, box.y + box.height],
                ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
                const xs = corners.map((p) => p.x),
                  ys = corners.map((p) => p.y);
                rt.texts.push({
                  text,
                  rect: {
                    x: Math.min(...xs) - 12,
                    y: Math.min(...ys) - 12,
                    width: Math.max(...xs) - Math.min(...xs) + 24,
                    height: Math.max(...ys) - Math.min(...ys) + 24,
                  },
                });
              } catch {
                /* Invisible text has no measurable box. */
              }
            }
          }
          return rt.texts
            .filter((t) => t.text.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 100);
        },
      }),
      [],
    );
    useEffect(() => {
      const view = viewport.current,
        host = surface.current;
      if (!view || !host || !props.svg) return;
      setError("");
      let parsed;
      try {
        parsed = parseSvg(props.svg.content);
      } catch (e) {
        const message = (e as Error).message;
        setError(message);
        latest.current.onError(message);
        return;
      }
      const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
      shadow.replaceChildren();
      const scene = svgElement("svg", {
        id: "cfg-scene",
        xmlns: "http://www.w3.org/2000/svg",
        "aria-label": "网络结构与绑定区域",
      });
      scene.style.cssText =
        "position:absolute;transform-origin:0 0;overflow:visible;max-width:none;display:block;background:#fafbfe;box-shadow:0 8px 40px #00000015";
      const overlay = svgElement("g", { id: "cfg-bindings" }),
        preview = svgElement("g", {
          id: "cfg-preview",
          "pointer-events": "none",
        });
      scene.append(parsed.svg, overlay, preview);
      shadow.append(scene);
      let disposed = false,
        cameraTimer: ReturnType<typeof setTimeout>,
        scaleFrame = 0,
        frame = 0;
      const rt: Runtime = {
        scene,
        original: parsed.svg,
        overlay,
        preview,
        base: parsed.bounds,
        bounds: { ...parsed.bounds },
        scale: props.camera?.scale || 1,
        offset: { x: 0, y: 0 },
        texts: null,
        getCamera() {
          return {
            scale: rt.scale,
            centerX:
              rt.bounds.x +
              (view.scrollLeft + view.clientWidth / 2 - rt.offset.x) / rt.scale,
            centerY:
              rt.bounds.y +
              (view.scrollTop + view.clientHeight / 2 - rt.offset.y) / rt.scale,
          };
        },
        position(c, emit = true) {
          if (disposed || !view.clientWidth || !view.clientHeight) return;
          rt.scale = Math.max(0.001, Math.min(8, c.scale));
          const b = rt.bounds,
            w = b.width * rt.scale,
            h = b.height * rt.scale;
          // A viewport of padding on each edge permits pointer-anchored zoom even
          // when the complete drawing is smaller than the viewport.
          rt.offset = {
            x: Math.max(64, view.clientWidth),
            y: Math.max(64, view.clientHeight),
          };
          host.style.width = `${w + rt.offset.x * 2}px`;
          host.style.height = `${h + rt.offset.y * 2}px`;
          scene.setAttribute("viewBox", `${b.x} ${b.y} ${b.width} ${b.height}`);
          scene.setAttribute("width", String(b.width));
          scene.setAttribute("height", String(b.height));
          scene.style.left = `${rt.offset.x}px`;
          scene.style.top = `${rt.offset.y}px`;
          scene.style.transform = `scale(${rt.scale})`;
          view.scrollLeft =
            (c.centerX - b.x) * rt.scale + rt.offset.x - view.clientWidth / 2;
          view.scrollTop =
            (c.centerY - b.y) * rt.scale + rt.offset.y - view.clientHeight / 2;
          if (!scaleFrame)
            scaleFrame = requestAnimationFrame(() => {
              scaleFrame = 0;
              latest.current.onScale(rt.scale);
            });
          if (emit) report();
        },
        fit(mode) {
          const b = rt.bounds;
          const k =
            mode === "actual"
              ? 1
              : mode === "width"
                ? (view.clientWidth - 80) / b.width
                : Math.min(
                    (view.clientWidth - 80) / b.width,
                    (view.clientHeight - 80) / b.height,
                  );
          rt.position({
            scale: Math.max(0.001, Math.min(8, k)),
            centerX: b.x + b.width / 2,
            centerY:
              mode === "width"
                ? b.y + Math.max(0, view.clientHeight / 2 - 40) / k
                : b.y + b.height / 2,
          });
        },
        focus(r) {
          const k = Math.max(
            0.001,
            Math.min(
              2,
              (view.clientWidth - 100) / Math.max(160, r.width),
              (view.clientHeight - 100) / Math.max(160, r.height),
            ),
          );
          rt.position({
            scale: k,
            centerX: r.x + r.width / 2,
            centerY: r.y + r.height / 2,
          });
          preview.replaceChildren(
            svgElement("rect", {
              ...r,
              fill: "#8978ff12",
              stroke: "#8978ff",
              "stroke-width": 2 / k,
              "stroke-dasharray": `${6 / k} ${4 / k}`,
              rx: 3,
            }),
          );
        },
        dispose() {},
      };
      runtime.current = rt;
      let lastCamera: Camera | null = props.camera;
      function report() {
        if (disposed) return;
        lastCamera = rt.getCamera();
        clearTimeout(cameraTimer);
        cameraTimer = setTimeout(() => {
          if (!disposed) latest.current.onCamera(rt.getCamera());
        }, 200);
      }
      function zoomAt(scale: number, clientX: number, clientY: number) {
        const p = clientToSvg(scene, clientX, clientY),
          rect = view!.getBoundingClientRect();
        const k = Math.max(0.001, Math.min(8, scale));
        rt.position({
          scale: k,
          centerX: p.x - (clientX - rect.left - view!.clientWidth / 2) / k,
          centerY: p.y - (clientY - rect.top - view!.clientHeight / 2) / k,
        });
      }
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        if (event.shiftKey) {
          view.scrollLeft += event.deltaY + event.deltaX;
          report();
          return;
        }
        if (event.altKey) {
          view.scrollTop += event.deltaY;
          report();
          return;
        }
        zoomAt(
          rt.scale *
            Math.exp(
              -Math.max(
                -200,
                Math.min(200, event.deltaY * (event.deltaMode === 1 ? 16 : 1)),
              ) * 0.002,
            ),
          event.clientX,
          event.clientY,
        );
      };
      const pointers = new Map<number, { x: number; y: number }>();
      let drag: {
        id: number;
        x: number;
        y: number;
        scrollX: number;
        scrollY: number;
        start: DOMPoint;
        bindingId: string | null;
        moved: boolean;
        selecting: boolean;
      } | null = null;
      let pinch: {
        distance: number;
        center: { x: number; y: number };
        scale: number;
        anchor: DOMPoint;
      } | null = null;
      const midpoint = () => {
        const [a, b] = [...pointers.values()];
        return {
          distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
      };
      const onDown = (e: PointerEvent) => {
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
        if (pointers.size === 2) {
          const p = midpoint();
          pinch = {
            ...p,
            scale: rt.scale,
            anchor: clientToSvg(scene, p.center.x, p.center.y),
          };
          drag = null;
          preview.replaceChildren();
          return;
        }
        if (pointers.size > 2) return;
        const bound = e
          .composedPath()
          .find(
            (n) => n instanceof Element && n.hasAttribute("data-binding"),
          ) as Element | undefined;
        drag = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          scrollX: view.scrollLeft,
          scrollY: view.scrollTop,
          start: clientToSvg(scene, e.clientX, e.clientY),
          bindingId: bound?.getAttribute("data-binding") || null,
          moved: false,
          selecting: latest.current.selecting && e.button === 0,
        };
        if (drag.selecting) preview.replaceChildren();
        view.classList.add("dragging");
      };
      let moveEvent: PointerEvent | null = null;
      const applyMove = (e: PointerEvent) => {
        if (pinch && pointers.size >= 2) {
          const p = midpoint(),
            box = view.getBoundingClientRect(),
            k = Math.max(
              0.001,
              Math.min(8, (pinch.scale * p.distance) / pinch.distance),
            );
          rt.position({
            scale: k,
            centerX:
              pinch.anchor.x -
              (p.center.x - box.left - view.clientWidth / 2) / k,
            centerY:
              pinch.anchor.y -
              (p.center.y - box.top - view.clientHeight / 2) / k,
          });
          return;
        }
        if (!drag || drag.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5)
          drag.moved = true;
        if (drag.selecting) {
          const r = rectFromPoints(
            drag.start,
            clientToSvg(scene, e.clientX, e.clientY),
          );
          preview.replaceChildren(
            svgElement("rect", {
              ...r,
              fill: "#8978ff25",
              stroke: "#8978ff",
              "stroke-width": 2 / rt.scale,
              "stroke-dasharray": `${5 / rt.scale} ${4 / rt.scale}`,
            }),
          );
        } else {
          view.scrollLeft = drag.scrollX - (e.clientX - drag.x);
          view.scrollTop = drag.scrollY - (e.clientY - drag.y);
          report();
        }
      };
      const onMove = (e: PointerEvent) => {
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
      const onUp = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return;
        cancelAnimationFrame(frame);
        frame = 0;
        if (moveEvent) applyMove(moveEvent);
        moveEvent = null;
        const d = drag;
        pointers.delete(e.pointerId);
        if (view.hasPointerCapture(e.pointerId))
          view.releasePointerCapture(e.pointerId);
        if (pinch) {
          pinch = null;
          drag = null;
          // A remaining finger starts a fresh pan, never a selection after pinch.
          const rest = [...pointers.entries()][0];
          if (rest)
            drag = {
              id: rest[0],
              x: rest[1].x,
              y: rest[1].y,
              scrollX: view.scrollLeft,
              scrollY: view.scrollTop,
              start: clientToSvg(scene, rest[1].x, rest[1].y),
              bindingId: null,
              moved: true,
              selecting: false,
            };
        } else if (d?.id === e.pointerId) {
          drag = null;
          if (d.selecting && e.type !== "pointercancel") {
            const r = rectFromPoints(
              d.start,
              clientToSvg(scene, e.clientX, e.clientY),
            );
            if (r.width * rt.scale > 5 && r.height * rt.scale > 5)
              latest.current.onRegion(r);
            preview.replaceChildren();
          } else if (!d.moved && d.bindingId && e.type !== "pointercancel")
            latest.current.onActivate(d.bindingId);
        }
        if (!pointers.size) view.classList.remove("dragging");
        report();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          latest.current.onCancel();
          preview.replaceChildren();
        }
        if (
          [
            "ArrowDown",
            "ArrowUp",
            "ArrowLeft",
            "ArrowRight",
            "PageDown",
            "PageUp",
            "Home",
            "End",
            "+",
            "-",
            "=",
          ].includes(e.key)
        ) {
          e.preventDefault();
          if (e.key === "+" || e.key === "=")
            zoomAt(
              rt.scale * 1.2,
              view.getBoundingClientRect().left + view.clientWidth / 2,
              view.getBoundingClientRect().top + view.clientHeight / 2,
            );
          else if (e.key === "-")
            zoomAt(
              rt.scale / 1.2,
              view.getBoundingClientRect().left + view.clientWidth / 2,
              view.getBoundingClientRect().top + view.clientHeight / 2,
            );
          else if (e.key === "Home") view.scrollTop = 0;
          else if (e.key === "End") view.scrollTop = view.scrollHeight;
          else {
            const distance = e.key.startsWith("Page")
              ? view.clientHeight * 0.85
              : 70;
            if (e.key.includes("Left")) view.scrollLeft -= distance;
            else if (e.key.includes("Right")) view.scrollLeft += distance;
            else view.scrollTop += e.key.endsWith("Up") ? -distance : distance;
          }
          report();
        }
      };
      const onScroll = () => report();
      view.addEventListener("wheel", onWheel, { passive: false });
      view.addEventListener("pointerdown", onDown);
      view.addEventListener("pointermove", onMove);
      view.addEventListener("pointerup", onUp);
      view.addEventListener("pointercancel", onUp);
      view.addEventListener("scroll", onScroll);
      view.addEventListener("keydown", onKey);
      let initialized = false;
      const resize = new ResizeObserver(() => {
        if (!view.clientWidth || !view.clientHeight) return;
        if (!initialized) {
          initialized = true;
          if (latest.current.camera) rt.position(latest.current.camera, false);
          else rt.fit("width");
        } else if (lastCamera) rt.position(lastCamera, false);
      });
      resize.observe(view);
      rt.dispose = () => {
        disposed = true;
        resize.disconnect();
        clearTimeout(cameraTimer);
        cancelAnimationFrame(frame);
        cancelAnimationFrame(scaleFrame);
        view.removeEventListener("wheel", onWheel);
        view.removeEventListener("pointerdown", onDown);
        view.removeEventListener("pointermove", onMove);
        view.removeEventListener("pointerup", onUp);
        view.removeEventListener("pointercancel", onUp);
        view.removeEventListener("scroll", onScroll);
        view.removeEventListener("keydown", onKey);
        shadow.replaceChildren();
      };
      return () => {
        rt.dispose();
        runtime.current = null;
      };
    }, [props.svg?.content]);
    useEffect(() => {
      const rt = runtime.current;
      if (!rt) return;
      const camera = rt.getCamera();
      const fragment = document.createDocumentFragment();
      let bounds = { ...rt.base };
      for (const binding of props.bindings) {
        const r = binding.svgRegion,
          active = binding.id === props.selectedId,
          c = binding.color;
        bounds = unionRect(bounds, r);
        const group = svgElement("g", {
          "data-binding": binding.id,
          "aria-label": binding.name,
          role: "button",
          tabindex: "0",
        });
        group.style.cursor = "pointer";
        const rect = svgElement("rect", {
          ...r,
          rx: 4,
          fill: active ? `${c}20` : `${c}06`,
          stroke: c,
          "stroke-width": active ? 2.5 : 1.1,
          "vector-effect": "non-scaling-stroke",
        });
        const title = svgElement("title");
        title.textContent = `${binding.name} · ${binding.code.file}:${binding.code.startLine}–${binding.code.endLine}`;
        rect.append(title);
        group.append(rect);
        const label = svgElement("text", {
          x: r.x + 6,
          y: r.y - 7,
          fill: c,
          "font-size": 12,
          "font-family": "system-ui, sans-serif",
          "font-weight": 600,
        });
        label.textContent = binding.name;
        group.append(label);
        group.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            latest.current.onActivate(binding.id);
          }
        });
        if (props.showCode) {
          const file = props.files.find((f) => f.name === binding.code.file);
          const code =
            file?.content
              .split("\n")
              .slice(binding.code.startLine - 1, binding.code.endLine) || [];
          const indent = Math.min(
            ...code
              .filter((l) => l.trim())
              .map((l) => l.match(/^\s*/)![0].length),
            80,
          );
          const lines = code.flatMap((line) => {
            const text = line.slice(Number.isFinite(indent) ? indent : 0);
            return text.match(/.{1,64}/g) || [""];
          });
          const width = Math.max(
            240,
            Math.min(
              600,
              Math.max(...lines.map((l) => l.length), binding.name.length) *
                7.5 +
                32,
            ),
          );
          const height = 45 + Math.max(1, lines.length) * 20;
          const p = binding.annotation || { x: r.x + r.width + 42, y: r.y };
          bounds = unionRect(bounds, {
            ...p,
            width: width + 20,
            height: height + 20,
          });
          group.append(
            svgElement("path", {
              d: `M${r.x + r.width} ${r.y + r.height / 2}H${p.x - 20}V${p.y + 24}H${p.x}`,
              fill: "none",
              stroke: c,
              "stroke-width": 1.5,
            }),
          );
          group.append(
            svgElement("rect", {
              ...p,
              width,
              height,
              rx: 6,
              fill: "#f6f7fd",
              stroke: c,
              "stroke-width": 1.2,
            }),
          );
          const heading = svgElement("text", {
            x: p.x + 14,
            y: p.y + 23,
            fill: c,
            "font-family": "system-ui, sans-serif",
            "font-size": 12,
            "font-weight": 600,
          });
          heading.textContent = `${binding.code.file} · L${binding.code.startLine}–${binding.code.endLine}`;
          group.append(heading);
          const text = svgElement("text", {
            x: p.x + 14,
            y: p.y + 47,
            fill: "#303549",
            "font-family": "Consolas, monospace",
            "font-size": 12,
            "xml:space": "preserve",
          });
          lines.forEach((line, i) => {
            const span = svgElement("tspan", { x: p.x + 14, dy: i ? 20 : 0 });
            span.textContent = line || " ";
            text.append(span);
          });
          group.append(text);
        }
        fragment.append(group);
      }
      rt.overlay.replaceChildren(fragment);
      rt.preview.replaceChildren();
      const changed = JSON.stringify(rt.bounds) !== JSON.stringify(bounds);
      rt.bounds = bounds;
      if (changed) rt.position(camera, false);
    }, [
      props.bindings,
      props.selectedId,
      props.showCode,
      props.files,
      props.svg?.content,
    ]);
    useEffect(() => {
      if (!props.selecting) runtime.current?.preview.replaceChildren();
    }, [props.selecting]);
    if (!props.svg)
      return (
        <div className="svg-empty">
          <FileImage size={44} strokeWidth={1.2} />
          <h3>添加网络结构图</h3>
          <p>
            上传 Netron 等工具导出的 SVG
            <br />
            随后框选任意区域，与代码建立绑定。
          </p>
          <button className="button primary" onClick={props.onUpload}>
            上传 SVG
          </button>
        </div>
      );
    return (
      <div className="viewer-shell">
        <div
          ref={viewport}
          tabIndex={0}
          aria-label="SVG 画布"
          className={`svg-viewport ${props.selecting ? "selecting" : ""}`}
        >
          <div ref={surface} className="svg-surface" />
          {error && <div className="svg-error">{error}</div>}
        </div>
        <div className={`viewer-hint ${props.selecting ? "binding-hint" : ""}`}>
          {props.selecting ? (
            <>
              <ScanLine size={14} />
              拖动框选网络区域 · 双指仍可缩放
              <button onClick={props.onCancel}>取消</button>
            </>
          ) : (
            <>
              <Move size={13} />
              拖动平移 · 滚轮 / 双指缩放 · Alt + 滚轮上下浏览
            </>
          )}
        </div>
      </div>
    );
  },
);
