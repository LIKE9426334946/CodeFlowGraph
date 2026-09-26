import { useCallback, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle, Settings2 } from "lucide-react";
import { SvgViewer, type SvgViewerHandle } from "./components/SvgViewer";
import { ImageLibrary } from "./components/ImageLibrary";
import { useContent } from "./lib/useContent";
import { parseSvg } from "./lib/svg";

const admin = /^\/admin\/?$/.test(window.location.pathname);
export default function App() {
  const viewer = useRef<SvgViewerHandle>(null);
  const beforeChange = useCallback(() => viewer.current?.finishEditing(), []);
  const {
    content,
    gallery,
    update,
    flush,
    status,
    error,
    busy,
    setEditing,
    open,
    add,
    rename,
    remove,
  } = useContent(beforeChange);
  const [message, setMessage] = useState(""),
    [uploading, setUploading] = useState(false),
    [sidebarHidden, setSidebarHidden] = useState(false);
  const svgInput = useRef<HTMLInputElement>(null);
  const uploadSvg = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      if (!file.name.toLowerCase().endsWith(".svg") || file.size > 30_000_000)
        throw new Error("请选择不超过 30 MB 的 SVG 文件");
      const text = await file.text();
      parseSvg(text);
      await add({ name: file.name, content: text });
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const working = busy || uploading;
  const actions = (
    <>
      <span
        className={`save-state ${status === "error" ? "failed" : ""}`}
        role="status"
      >
        {working || status === "pending" || status === "saving" ? (
          <LoaderCircle size={14} className="spin" />
        ) : status === "saved" ? (
          <Check size={14} />
        ) : null}
        {working
          ? "正在处理…"
          : status === "saved"
            ? "已保存"
            : status === "error"
              ? "保存失败"
              : "正在保存…"}
      </span>
      {admin ? (
        <a
          className="button"
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="打开显示页"
          title="打开显示页"
        >
          <ExternalLink size={19} />
          <span>打开显示页</span>
        </a>
      ) : (
        <a
          className="button"
          href="/admin"
          aria-label="管理图片"
          title="管理图片"
        >
          <Settings2 size={19} />
          <span>管理图片</span>
        </a>
      )}
    </>
  );
  return (
    <div className={`app ${admin ? "admin" : "display"}`} aria-busy={working}>
      {(error || message) && (
        <div className="error-banner" role="alert">
          <span>{message || error}</span>
          {message ? (
            <button onClick={() => setMessage("")}>关闭</button>
          ) : status === "error" ? (
            <button onClick={() => void flush().catch(() => {})}>
              重试保存
            </button>
          ) : (
            <button onClick={() => window.location.reload()}>重新加载</button>
          )}
        </div>
      )}
      {!gallery ? (
        <div className="loading">
          {error ? "暂时无法加载图片" : "正在加载…"}
        </div>
      ) : (
        <div className="workspace" inert={working}>
          <SvgViewer
            key={content?.id || "empty"}
            ref={viewer}
            svg={content?.svg || null}
            name={content?.name}
            labels={content?.labels || []}
            onLabelsChange={(labels) => {
              if (admin) update(labels);
            }}
            onEditingChange={setEditing}
            actions={actions}
            admin={admin}
            sidebarHidden={sidebarHidden}
            onToggleSidebar={() => setSidebarHidden((hidden) => !hidden)}
            onUpload={() => svgInput.current?.click()}
            library={
              <ImageLibrary
                gallery={gallery}
                current={content}
                admin={admin}
                onOpen={open}
                onAdd={() => svgInput.current?.click()}
                onRename={rename}
                onDelete={remove}
              />
            }
          />
        </div>
      )}
      {admin && (
        <input
          hidden
          ref={svgInput}
          type="file"
          accept=".svg,image/svg+xml"
          onChange={(e) => {
            void uploadSvg(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      )}
    </div>
  );
}
