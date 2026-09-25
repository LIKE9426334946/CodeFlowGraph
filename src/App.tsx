import { useEffect, useRef, useState } from "react";
import {
  Code2,
  Columns2,
  Image,
  Upload,
  Save,
  ExternalLink,
  Settings2,
  Maximize,
  Minimize,
  Check,
  LoaderCircle,
} from "lucide-react";
import { CodeEditor } from "./components/CodeEditor";
import { SvgViewer } from "./components/SvgViewer";
import { useContent } from "./lib/useContent";
import { parseSvg } from "./lib/svg";
import type { DisplayMode } from "./types";

const admin = /^\/admin\/?$/.test(window.location.pathname);
function readMode(): DisplayMode {
  try {
    const mode = localStorage.getItem("codeflowgraph-display-mode");
    return mode === "code" || mode === "svg" ? mode : "split";
  } catch {
    return "split";
  }
}
export default function App() {
  const { content, update, flush, status, error } = useContent(admin);
  const [mode, setMode] = useState<DisplayMode>(admin ? "split" : readMode);
  const [message, setMessage] = useState(""),
    [fullscreen, setFullscreen] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null),
    svgInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!admin) {
      try {
        localStorage.setItem("codeflowgraph-display-mode", mode);
      } catch {
        /* Private browsing can disable storage. */
      }
    }
  }, [mode]);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const uploadCode = async (file?: File) => {
    if (!file) return;
    try {
      if (!/\.(py|txt)$/i.test(file.name) || file.size > 2_000_000)
        throw new Error("请选择不超过 2 MB 的 .py 或 .txt 文件");
      update({ code: { name: file.name, content: await file.text() } });
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const uploadSvg = async (file?: File) => {
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith(".svg") || file.size > 30_000_000)
        throw new Error("请选择不超过 30 MB 的 SVG 文件");
      const text = await file.text();
      parseSvg(text);
      update({ svg: { name: file.name, content: text } });
      setMessage("");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setMessage("此浏览器不支持页面全屏，可使用代码全屏或 SVG 全屏模式。");
    }
  };
  return (
    <div className={`app ${admin ? "admin" : "display"} mode-${mode}`}>
      <header className="topbar">
        <a className="brand" href={admin ? "/admin" : "/"}>
          <span>
            <Code2 size={21} />
          </span>
          <strong>CodeFlowGraph</strong>
        </a>
        {admin ? (
          <>
            <span className="admin-label">管理</span>
            <span
              className={`save-state ${status === "error" ? "failed" : ""}`}
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
            <button
              className="button"
              disabled={!content}
              onClick={() => void flush().catch(() => {})}
            >
              <Save size={15} />
              <span>保存</span>
            </button>
            <a
              className="button primary"
              href="/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={15} />
              <span>打开显示页</span>
            </a>
          </>
        ) : (
          <>
            <nav className="mode-switch" aria-label="显示模式">
              <button
                className={mode === "split" ? "active" : ""}
                aria-pressed={mode === "split"}
                onClick={() => setMode("split")}
              >
                <Columns2 size={16} />
                <span>左右分屏</span>
              </button>
              <button
                className={mode === "code" ? "active" : ""}
                aria-pressed={mode === "code"}
                onClick={() => setMode("code")}
              >
                <Code2 size={16} />
                <span>代码全屏</span>
              </button>
              <button
                className={mode === "svg" ? "active" : ""}
                aria-pressed={mode === "svg"}
                onClick={() => setMode("svg")}
              >
                <Image size={16} />
                <span>SVG 全屏</span>
              </button>
            </nav>
            <div className="display-actions">
              {document.fullscreenEnabled && (
                <button
                  className="icon-button"
                  title={fullscreen ? "退出浏览器全屏" : "进入浏览器全屏"}
                  aria-label={fullscreen ? "退出浏览器全屏" : "进入浏览器全屏"}
                  onClick={() => void toggleFullscreen()}
                >
                  {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              )}
              <a className="manage-link" href="/admin" title="管理界面">
                <Settings2 size={17} />
                <span>管理</span>
              </a>
            </div>
          </>
        )}
      </header>
      {(error || message) && (
        <div className="error-banner" role="alert">
          <span>{message || error}</span>
          {message ? (
            <button onClick={() => setMessage("")}>关闭</button>
          ) : admin && content ? (
            <button onClick={() => void flush().catch(() => {})}>
              重试保存
            </button>
          ) : !content ? (
            <button onClick={() => window.location.reload()}>重新加载</button>
          ) : null}
        </div>
      )}
      {!content ? (
        <div className="loading">
          {error ? "暂时无法加载内容" : "正在加载…"}
        </div>
      ) : (
        <main className="panes">
          <section className="pane code-pane">
            <header className="pane-header">
              <span className="pane-title">
                <Code2 size={16} />
                <strong>{admin ? "代码" : content.code.name}</strong>
                {admin && <small>{content.code.name}</small>}
              </span>
              {admin && (
                <button
                  className="button"
                  onClick={() => codeInput.current?.click()}
                >
                  <Upload size={14} />
                  上传代码
                </button>
              )}
            </header>
            <CodeEditor
              value={content.code.content}
              readOnly={!admin}
              onChange={(value) =>
                update({ code: { ...content.code, content: value } })
              }
            />
          </section>
          <section className="pane svg-pane">
            <header className="pane-header">
              <span className="pane-title">
                <Image size={16} />
                <strong>
                  {admin ? "SVG 图片" : content.svg?.name || "SVG 图片"}
                </strong>
              </span>
              {admin && (
                <button
                  className="button"
                  onClick={() => svgInput.current?.click()}
                >
                  <Upload size={14} />
                  {content.svg ? "替换 SVG" : "上传 SVG"}
                </button>
              )}
            </header>
            <SvgViewer svg={content.svg} />
          </section>
        </main>
      )}
      {admin && (
        <>
          <input
            hidden
            ref={codeInput}
            type="file"
            accept=".py,.txt"
            onChange={(e) => {
              void uploadCode(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
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
          <footer className="admin-footer">
            编辑后自动保存到服务器，显示页会同步更新。
          </footer>
        </>
      )}
    </div>
  );
}
