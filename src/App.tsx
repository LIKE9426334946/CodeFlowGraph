import { useRef, useState } from "react";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  Settings2,
  Upload,
} from "lucide-react";
import { SvgViewer } from "./components/SvgViewer";
import { useContent } from "./lib/useContent";
import { parseSvg } from "./lib/svg";

const admin = /^\/admin\/?$/.test(window.location.pathname);
export default function App() {
  const { content, update, flush, status, error, setEditing } = useContent();
  const [message, setMessage] = useState("");
  const svgInput = useRef<HTMLInputElement>(null);
  const uploadSvg = async (file?: File) => {
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith(".svg") || file.size > 30_000_000)
        throw new Error("请选择不超过 30 MB 的 SVG 文件");
      const text = await file.text();
      parseSvg(text);
      const changed = text !== content?.svg?.content;
      if (
        changed &&
        content?.labels.length &&
        !window.confirm("替换 SVG 会清空当前图片上的标签，是否继续？")
      )
        return;
      update({
        svg: { name: file.name, content: text },
        ...(changed ? { labels: [] } : {}),
      });
      await flush();
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const actions = (
    <>
      <span
        className={`save-state ${status === "error" ? "failed" : ""}`}
        role="status"
      >
        {status === "saved" ? (
          <Check size={14} />
        ) : status === "error" ? null : (
          <LoaderCircle size={14} className="spin" />
        )}
        {status === "saved"
          ? "已保存"
          : status === "error"
            ? "保存失败"
            : "正在保存…"}
      </span>
      {admin ? (
        <>
          <button
            className="button"
            disabled={!content}
            onClick={() => svgInput.current?.click()}
          >
            <Upload size={17} />
            <span>{content?.svg ? "替换 SVG" : "上传 SVG"}</span>
          </button>
          <a
            className="icon-button"
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="打开显示页"
            title="打开显示页"
          >
            <ExternalLink size={19} />
          </a>
        </>
      ) : (
        <a
          className="icon-button"
          href="/admin"
          aria-label="管理图片"
          title="管理图片"
        >
          <Settings2 size={19} />
        </a>
      )}
    </>
  );
  return (
    <div className={`app ${admin ? "admin" : "display"}`}>
      {(error || message) && (
        <div className="error-banner" role="alert">
          <span>{message || error}</span>
          {message ? (
            <button onClick={() => setMessage("")}>关闭</button>
          ) : content ? (
            <button onClick={() => void flush().catch(() => {})}>
              重试保存
            </button>
          ) : (
            <button onClick={() => window.location.reload()}>重新加载</button>
          )}
        </div>
      )}
      {!content ? (
        <div className="loading">
          {error ? "暂时无法加载内容" : "正在加载…"}
        </div>
      ) : (
        <SvgViewer
          svg={content.svg}
          labels={content.labels}
          onLabelsChange={(labels) => update({ labels })}
          onEditingChange={setEditing}
          actions={actions}
          admin={admin}
          onUpload={() => svgInput.current?.click()}
        />
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
