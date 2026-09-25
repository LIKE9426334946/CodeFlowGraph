import { useEffect, useRef, useState } from "react";
import { Image, Minus, Plus, Scan } from "lucide-react";
import type { Camera, TextFile } from "../types";
import { clientToSvg, parseSvg, svgElement } from "../lib/svg";

type Controls = {
  zoom: (factor: number) => void;
  actual: () => void;
  fit: () => void;
};
export function SvgViewer({ svg }: { svg: TextFile | null }) {
  const viewport = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLButtonElement>(null),
    controls = useRef<Controls | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const view = viewport.current,
      host = surface.current;
    if (!svg || !view || !host) return;
    setError("");
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
    const scene = svgElement("svg", {
      id: "display-svg",
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
      width: bounds.width,
      height: bounds.height,
      "aria-label": "SVG 图片",
    });
    scene.style.cssText =
      "position:absolute;transform-origin:0 0;overflow:visible;display:block;background:white;box-shadow:0 4px 24px #26304312;";
    scene.append(original);
    shadow.append(scene);
    let scale = 1,
      offsetX = 0,
      offsetY = 0,
      autoFit = true,
      frame = 0;
    let camera: Camera | null = null;
    const clampScale = (value: number) => Math.max(0.001, Math.min(8, value));
    const readCamera = (): Camera => ({
      scale,
      centerX:
        bounds.x + (view.scrollLeft + view.clientWidth / 2 - offsetX) / scale,
      centerY:
        bounds.y + (view.scrollTop + view.clientHeight / 2 - offsetY) / scale,
    });
    const position = (next: Camera) => {
      if (!view.clientWidth || !view.clientHeight) return;
      scale = clampScale(next.scale);
      offsetX = view.clientWidth;
      offsetY = view.clientHeight;
      host.style.width = `${bounds.width * scale + offsetX * 2}px`;
      host.style.height = `${bounds.height * scale + offsetY * 2}px`;
      scene.style.left = `${offsetX}px`;
      scene.style.top = `${offsetY}px`;
      scene.style.transform = `scale(${scale})`;
      view.scrollLeft =
        (next.centerX - bounds.x) * scale + offsetX - view.clientWidth / 2;
      view.scrollTop =
        (next.centerY - bounds.y) * scale + offsetY - view.clientHeight / 2;
      if (percent.current)
        percent.current.textContent = `${(scale * 100).toFixed(scale < 0.1 ? 1 : 0)}%`;
      camera = readCamera();
    };
    const fit = () => {
      autoFit = true;
      const k = clampScale((view.clientWidth - 48) / bounds.width);
      const fitsHeight = bounds.height * k < view.clientHeight - 48;
      position({
        scale: k,
        centerX: bounds.x + bounds.width / 2,
        centerY: fitsHeight
          ? bounds.y + bounds.height / 2
          : bounds.y + (view.clientHeight / 2 - 24) / k,
      });
    };
    const zoomAt = (next: number, x: number, y: number) => {
      autoFit = false;
      const p = clientToSvg(scene, x, y),
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
      // Ordinary wheel scrolling stays native; Ctrl/⌘ + wheel zooms the picture.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(
          scale * Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002),
          e.clientX,
          e.clientY,
        );
      }
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let pan: {
      id: number;
      x: number;
      y: number;
      left: number;
      top: number;
    } | null = null;
    let pinch: { distance: number; scale: number; anchor: DOMPoint } | null =
      null;
    let moveEvent: PointerEvent | null = null;
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
      view.classList.add("dragging");
      if (pointers.size === 1)
        pan = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          left: view.scrollLeft,
          top: view.scrollTop,
        };
      else if (pointers.size === 2) {
        const p = midpoint();
        pinch = {
          distance: p.distance,
          scale,
          anchor: clientToSvg(scene, p.x, p.y),
        };
        pan = null;
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
      } else if (pan?.id === e.pointerId) {
        view.scrollLeft = pan.left - (e.clientX - pan.x);
        view.scrollTop = pan.top - (e.clientY - pan.y);
        camera = readCamera();
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
      cancelAnimationFrame(frame);
      frame = 0;
      if (moveEvent) applyMove(moveEvent);
      moveEvent = null;
      pointers.delete(e.pointerId);
      if (view.hasPointerCapture(e.pointerId))
        view.releasePointerCapture(e.pointerId);
      pinch = null;
      pan = null;
      const rest = [...pointers][0];
      if (rest)
        pan = {
          id: rest[0],
          x: rest[1].x,
          y: rest[1].y,
          left: view.scrollLeft,
          top: view.scrollTop,
        };
      if (!pointers.size) view.classList.remove("dragging");
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
    view.addEventListener("scroll", scroll);
    resize.observe(view);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      controls.current = null;
      shadow.replaceChildren();
      view.removeEventListener("wheel", wheel);
      view.removeEventListener("pointerdown", start);
      view.removeEventListener("pointermove", move);
      view.removeEventListener("pointerup", end);
      view.removeEventListener("pointercancel", end);
      view.removeEventListener("scroll", scroll);
    };
  }, [svg?.content]);
  if (!svg)
    return (
      <div className="empty-svg">
        <Image size={38} strokeWidth={1.3} />
        <p>请在管理页上传 SVG 图片</p>
      </div>
    );
  return (
    <div className="svg-viewer">
      <div className="viewer-tools">
        <button
          className="icon-button"
          aria-label="缩小图片"
          title="缩小图片"
          onClick={() => controls.current?.zoom(1 / 1.2)}
        >
          <Minus size={16} />
        </button>
        <button
          className="zoom-label"
          ref={percent}
          title="恢复 100%"
          onClick={() => controls.current?.actual()}
        >
          100%
        </button>
        <button
          className="icon-button"
          aria-label="放大图片"
          title="放大图片"
          onClick={() => controls.current?.zoom(1.2)}
        >
          <Plus size={16} />
        </button>
        <button className="fit-button" onClick={() => controls.current?.fit()}>
          <Scan size={15} />
          适应宽度
        </button>
        <span>滚动浏览 · 双指缩放</span>
      </div>
      <div
        ref={viewport}
        className="svg-viewport"
        tabIndex={0}
        aria-label="SVG 查看区域"
      >
        <div ref={surface} className="svg-surface" />
        {error && (
          <div className="svg-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
