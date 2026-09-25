import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Download,
  FileCode2,
  FileImage,
  Files,
  FolderOpen,
  HelpCircle,
  Link2,
  List,
  LoaderCircle,
  Maximize,
  Moon,
  PanelLeftClose,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  Pencil,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { api, downloadResponse } from "./lib/api";
import { useProject } from "./lib/useProject";
import { parseSvg } from "./lib/svg";
import { CodeEditor, type CodeEditorHandle } from "./components/CodeEditor";
import { SvgViewer, type SvgViewerHandle } from "./components/SvgViewer";
import { BindingInspector } from "./components/BindingInspector";
import { Dialog } from "./components/Dialog";
import {
  COLORS,
  type Binding,
  type CodeSelection,
  type Project,
  type ProjectSummary,
  type Rect,
  type UIState,
} from "./types";

function Tool({
  label,
  children,
  onClick,
  active,
  disabled,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
const uid = () =>
  crypto.randomUUID?.() ||
  `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
const sameView = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export default function App() {
  const { project, current, update, load, flush, saveState, saveError } =
    useProject();
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
    | "projects"
    | "search"
    | "help"
    | "new-file"
    | "rename-file"
    | "rename-project"
    | null
  >(null);
  const [draft, setDraft] = useState(""),
    [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 1150),
    [sideTab, setSideTab] = useState<"files" | "bindings">("files");
  const [inspector, setInspector] = useState(false),
    [selection, setSelection] = useState<CodeSelection | null>(null);
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const [pending, setPending] = useState<{
    range: CodeSelection;
    id?: string;
  } | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [confirmation, setConfirmation] = useState<{
    message: string;
    run: () => void;
  } | null>(null);
  const editor = useRef<CodeEditorHandle>(null),
    viewer = useRef<SvgViewerHandle>(null),
    workspace = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null),
    svgInput = useRef<HTMLInputElement>(null),
    zipInput = useRef<HTMLInputElement>(null);
  const revealTarget = useRef<CodeSelection | null>(null);
  const activeFile =
    project?.files.find((f) => f.id === project.ui.activeFileId) ||
    project?.files[0];
  const selected = project?.bindings.find(
    (b) => b.id === project.ui.selectedBindingId,
  );
  const notify = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 5500);
  }, []);
  const run = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      try {
        await task();
      } catch (e) {
        notify((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );
  const refreshList = async () => {
    const b = await api<{ projects: ProjectSummary[] }>("/bootstrap");
    setProjects(b.projects);
  };
  const updateUI = useCallback(
    (patch: Partial<UIState>) =>
      update((p) => {
        const ui = { ...p.ui, ...patch };
        return sameView(ui, p.ui) ? p : { ...p, ui };
      }),
    [update],
  );
  const captureCamera = () => {
    const camera = viewer.current?.camera();
    if (camera) updateUI({ camera });
  };
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const b = await api<{
          projects: ProjectSummary[];
          activeProjectId: string | null;
        }>("/bootstrap");
        if (!live) return;
        setProjects(b.projects);
        const id =
          b.projects.find((p) => p.id === b.activeProjectId)?.id ||
          b.projects[0]?.id;
        if (id) {
          const p = await api<Project>(`/projects/${id}`);
          if (live) load(p);
        }
      } catch (e) {
        if (live) notify((e as Error).message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [load, notify]);
  useEffect(() => {
    document.documentElement.dataset.theme = project?.ui.theme || "dark";
  }, [project?.ui.theme]);
  useEffect(() => {
    const compact = window.matchMedia(
      "(max-width: 1000px), (orientation: portrait)",
    );
    const close = () => {
      if (compact.matches) setSidebar(false);
    };
    close();
    compact.addEventListener("change", close);
    return () => compact.removeEventListener("change", close);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        captureCamera();
        void flush().catch((e) => notify(e.message));
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setModal("search");
      }
      if (e.key === "Escape") setPending(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [flush, updateUI, notify]);
  useEffect(() => {
    const t = revealTarget.current;
    if (t && activeFile?.name === t.file) {
      const frame = requestAnimationFrame(() => {
        editor.current?.reveal(t.startLine, t.endLine);
        revealTarget.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [activeFile?.id]);
  const openProject = async (id: string) => {
    captureCamera();
    await flush();
    const p = await api<Project>(`/projects/${id}`);
    await api("/workspace", {
      method: "PUT",
      body: JSON.stringify({ activeProjectId: id }),
    });
    load(p);
    setSelection(null);
    setPending(null);
    setInspector(false);
    setModal(null);
    await refreshList();
  };
  const createProject = async (template?: string) => {
    captureCamera();
    await flush();
    const p = await api<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({
        name:
          draft.trim() || (template ? "Multi-Head Attention" : "未命名项目"),
        template,
      }),
    });
    load(p);
    setPending(null);
    setSelection(null);
    setInspector(false);
    setModal(null);
    setDraft("");
    await refreshList();
  };
  const selectFile = (id: string) => {
    setPending(null);
    updateUI({ activeFileId: id, portraitTab: "code" });
  };
  const activate = (id: string, origin: "code" | "svg" | "list" = "list") => {
    const p = current.current,
      b = p?.bindings.find((b) => b.id === id);
    if (!p || !b) return;
    const f = p.files.find((f) => f.name === b.code.file);
    if (!f) return;
    updateUI({
      selectedBindingId: id,
      activeFileId: f.id,
      portraitTab: origin === "svg" ? "code" : "svg",
    });
    if (origin !== "code") {
      revealTarget.current = b.code;
      if (activeFile?.id === f.id) {
        requestAnimationFrame(() =>
          editor.current?.reveal(b.code.startLine, b.code.endLine),
        );
        revealTarget.current = null;
      }
    }
    if (origin !== "svg")
      requestAnimationFrame(() => viewer.current?.focus(b.svgRegion));
    if (origin === "svg" || origin === "list") setInspector(true);
  };
  const beginBinding = () => {
    if (pending) {
      setPending(null);
      return;
    }
    if (!project?.svg || !activeFile) return;
    const range =
      selection?.file === activeFile.name
        ? selection
        : { file: activeFile.name, startLine: 1, endLine: 1 };
    setPending({ range });
    updateUI({ portraitTab: "svg" });
  };
  const createRegion = (region: Rect) => {
    if (!pending || !project) return;
    const id = pending.id || uid();
    update((p) => ({
      ...p,
      bindings: pending.id
        ? p.bindings.map((b) => (b.id === id ? { ...b, svgRegion: region } : b))
        : [
            ...p.bindings,
            {
              id,
              name: `绑定 ${p.bindings.length + 1}`,
              color: COLORS[p.bindings.length % COLORS.length],
              code: { ...pending.range },
              svgRegion: region,
              note: "",
            },
          ],
      ui: { ...p.ui, selectedBindingId: id },
    }));
    setPending(null);
    setInspector(true);
    notify(
      pending.id
        ? "已更新 SVG 区域"
        : `已绑定 ${pending.range.file} 第 ${pending.range.startLine}–${pending.range.endLine} 行`,
    );
  };
  const editBinding = (binding: Binding) =>
    update((p) => ({
      ...p,
      bindings: p.bindings.map((b) => (b.id === binding.id ? binding : b)),
    }));
  const removeBinding = (b: Binding) =>
    setConfirmation({
      message: `删除绑定“${b.name}”？代码和 SVG 文件会保留。`,
      run: () => {
        update((p) => ({
          ...p,
          bindings: p.bindings.filter((x) => x.id !== b.id),
          ui: {
            ...p.ui,
            selectedBindingId:
              p.ui.selectedBindingId === b.id ? null : p.ui.selectedBindingId,
          },
        }));
        setInspector(false);
        setPending(null);
      },
    });
  const removeFile = () => {
    if (!activeFile || !project) return;
    if (project.files.length === 1) {
      notify("项目至少需要一个代码文件");
      return;
    }
    const f = activeFile;
    setConfirmation({
      message: `删除 ${f.name} 及其全部绑定？`,
      run: () =>
        update((p) => {
          const files = p.files.filter((x) => x.id !== f.id);
          return {
            ...p,
            files,
            bindings: p.bindings.filter((b) => b.code.file !== f.name),
            ui: { ...p.ui, activeFileId: files[0].id, selectedBindingId: null },
          };
        }),
    });
  };
  const writeFileName = () => {
    const name = draft.trim().endsWith(".py")
      ? draft.trim()
      : `${draft.trim()}.py`;
    if (
      !name ||
      name === ".py" ||
      /[/\\\x00-\x1f]/.test(name) ||
      name.startsWith(".") ||
      name.length > 150
    ) {
      notify("请输入有效的 Python 文件名");
      return;
    }
    if (
      project?.files.some(
        (f) =>
          f.name.toLowerCase() === name.toLowerCase() &&
          (modal !== "rename-file" || f.id !== activeFile?.id),
      )
    ) {
      notify("已存在同名文件");
      return;
    }
    if (modal === "new-file") {
      const id = uid();
      update((p) => ({
        ...p,
        files: [...p.files, { id, name, content: "" }],
        ui: { ...p.ui, activeFileId: id, portraitTab: "code" },
      }));
    } else if (activeFile)
      update((p) => ({
        ...p,
        files: p.files.map((f) =>
          f.id === activeFile.id ? { ...f, name } : f,
        ),
        bindings: p.bindings.map((b) =>
          b.code.file === activeFile.name
            ? { ...b, code: { ...b.code, file: name } }
            : b,
        ),
      }));
    setModal(null);
    setPending(null);
  };
  const uploadCode = async (list: FileList | null) => {
    if (!list?.length || !current.current) return;
    const incoming: Project["files"] = [];
    for (const f of [...list]) {
      if (!f.name.toLowerCase().endsWith(".py") || f.size > 2_000_000)
        throw new Error("请选择不超过 2 MB 的 .py 文件");
      let name = f.name,
        i = 2;
      while (
        [...current.current.files, ...incoming].some(
          (x) => x.name.toLowerCase() === name.toLowerCase(),
        )
      )
        name = f.name.replace(/\.py$/i, `_${i++}.py`);
      incoming.push({ id: uid(), name, content: await f.text() });
    }
    if (current.current.files.length + incoming.length > 64)
      throw new Error("每个项目最多支持 64 个文件");
    update((p) => ({
      ...p,
      files: [...p.files, ...incoming],
      ui: { ...p.ui, activeFileId: incoming[0].id, portraitTab: "code" },
    }));
    setPending(null);
    notify(`已添加 ${incoming.length} 个代码文件`);
  };
  const uploadSvg = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".svg") || file.size > 30_000_000)
      throw new Error("请选择不超过 30 MB 的 SVG 文件");
    const content = await file.text();
    parseSvg(content);
    const apply = () => {
      update((p) => ({
        ...p,
        svg: { name: file.name, content },
        bindings: [],
        ui: {
          ...p.ui,
          camera: null,
          selectedBindingId: null,
          portraitTab: "svg",
        },
      }));
      setPending(null);
      setInspector(false);
    };
    if (current.current?.bindings.length)
      setConfirmation({
        message: "替换 SVG 会清除现有绑定，以便为新结构图重新标注。是否继续？",
        run: apply,
      });
    else apply();
  };
  const importZip = async (file?: File) => {
    if (!file) return;
    if (file.size > 40_000_000) throw new Error("ZIP 文件不能超过 40 MB");
    captureCamera();
    await flush();
    const p = await api<Project>("/projects/import", {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/zip" },
    });
    load(p);
    setPending(null);
    setSelection(null);
    setInspector(false);
    setModal(null);
    await refreshList();
    notify("项目已导入，原项目保持不变");
  };
  const exportZip = async () => {
    if (!current.current) return;
    captureCamera();
    if (saveState === "conflict" || saveState === "error") {
      const { default: JSZip } = await import("jszip");
      const p = current.current,
        zip = new JSZip();
      zip.file(
        "project.json",
        JSON.stringify(
          {
            format: "CodeFlowGraph",
            formatVersion: 1,
            name: p.name,
            files: p.files.map(({ content, ...f }) => f),
            svg: p.svg ? { name: p.svg.name } : null,
            ui: p.ui,
          },
          null,
          2,
        ),
      );
      zip.file("bindings.json", JSON.stringify(p.bindings, null, 2));
      for (const f of p.files) zip.file(f.name, f.content);
      if (p.svg) zip.file(p.svg.name, p.svg.content);
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      await downloadResponse(new Response(blob), `${p.name}-本地副本.zip`);
      return;
    }
    await flush();
    await downloadResponse(
      await fetch(`/api/projects/${current.current.id}/export`),
      `${current.current.name}.zip`,
    );
  };
  const onSelection = useCallback(
    (range: CodeSelection) =>
      setSelection((old) => (sameView(old, range) ? old : range)),
    [],
  );
  const editorView = useCallback(
    (v: UIState["editorViews"][string]) =>
      update((p) => {
        const id = p.ui.activeFileId || p.files[0].id;
        return sameView(p.ui.editorViews[id], v)
          ? p
          : {
              ...p,
              ui: { ...p.ui, editorViews: { ...p.ui.editorViews, [id]: v } },
            };
      }),
    [update],
  );
  const updateCode = (
    content: string,
    bindings: Binding[],
    view: UIState["editorViews"][string],
  ) => {
    if (!activeFile) return;
    const id = activeFile.id,
      file = activeFile.name;
    update((p) => ({
      ...p,
      files: p.files.map((f) => (f.id === id ? { ...f, content } : f)),
      bindings: p.bindings.map((b) =>
        b.code.file === file ? bindings.find((x) => x.id === b.id) || b : b,
      ),
      ui: { ...p.ui, editorViews: { ...p.ui.editorViews, [id]: view } },
    }));
    if (pending?.range.file === file) setPending(null);
  };
  const splitterDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const element = e.currentTarget,
      box = workspace.current!.getBoundingClientRect();
    let ratio = current.current!.ui.split;
    const move = (ev: PointerEvent) => {
      ratio = Math.max(
        22,
        Math.min(78, ((ev.clientX - box.left) / box.width) * 100),
      );
      workspace.current!.style.setProperty("--split", `${ratio}%`);
    };
    const up = (ev: PointerEvent) => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      if (element.hasPointerCapture(ev.pointerId))
        element.releasePointerCapture(ev.pointerId);
      updateUI({ split: Math.round(ratio * 10) / 10 });
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
  };
  type Result = {
    key: string;
    type: string;
    title: string;
    detail: string;
    go: () => void;
  };
  const results: Result[] = [];
  const term = deferredQuery.trim().toLowerCase();
  if (modal === "search" && term && project) {
    for (const b of project.bindings)
      if (`${b.name}\n${b.note}`.toLowerCase().includes(term))
        results.push({
          key: b.id,
          type: "绑定 / 备注",
          title: b.name,
          detail: `${b.code.file} · L${b.code.startLine}–${b.code.endLine}`,
          go: () => activate(b.id),
        });
    for (const f of project.files) {
      const lines = f.content.split("\n");
      for (let i = 0; i < lines.length && results.length < 160; i++)
        if (lines[i].toLowerCase().includes(term)) {
          const n = i + 1;
          results.push({
            key: `${f.id}-${n}`,
            type: "代码",
            title: lines[i].trim(),
            detail: `${f.name} · L${n}`,
            go: () => {
              revealTarget.current = { file: f.name, startLine: n, endLine: n };
              updateUI({ activeFileId: f.id, portraitTab: "code" });
              requestAnimationFrame(() => {
                if (current.current?.ui.activeFileId === f.id)
                  editor.current?.reveal(n, n);
              });
            },
          });
        }
    }
    for (const t of viewer.current?.search(term) || [])
      results.push({
        key: `svg-${results.length}`,
        type: "SVG 文字",
        title: t.text,
        detail: project.svg?.name || "SVG",
        go: () => {
          updateUI({ portraitTab: "svg" });
          requestAnimationFrame(() => viewer.current?.focus(t.rect));
        },
      });
  }
  const statusText =
    saveState === "saved"
      ? "已保存"
      : saveState === "error"
        ? "保存失败"
        : saveState === "conflict"
          ? "保存冲突"
          : "正在保存…";
  return (
    <div className="app-shell">
      <input
        hidden
        ref={codeInput}
        type="file"
        accept=".py"
        multiple
        onChange={(e) => {
          const f = e.target.files;
          void run(() => uploadCode(f));
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={svgInput}
        type="file"
        accept=".svg,image/svg+xml"
        onChange={(e) => {
          const f = e.target.files?.[0];
          void run(() => uploadSvg(f));
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          void run(() => importZip(f));
          e.target.value = "";
        }}
      />
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">
            <Code2 size={23} />
          </span>
          <strong>
            CodeFlow<span>Graph</span>
          </strong>
        </div>
        <span className="header-divider" />
        <button
          className="project-switch"
          onClick={() => {
            setDraft("");
            setModal("projects");
          }}
        >
          <FolderOpen size={16} />
          <span>{project?.name || "选择项目"}</span>
          <ChevronDown size={14} />
        </button>
        <button
          className="global-search"
          onClick={() => setModal("search")}
          disabled={!project}
        >
          <Search size={16} />
          <span>搜索代码、结构图、绑定…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div
          className={`save-status ${saveState === "error" || saveState === "conflict" ? "error" : ""}`}
        >
          {saveState === "saved" ? (
            <Check size={14} />
          ) : saveState === "conflict" || saveState === "error" ? (
            <AlertCircle size={14} />
          ) : (
            <LoaderCircle className="spin" size={14} />
          )}
          <span>{project ? statusText : "工作空间"}</span>
        </div>
        <Tool
          label={
            project?.ui.theme === "light" ? "切换深色模式" : "切换浅色模式"
          }
          onClick={() =>
            updateUI({
              theme: project?.ui.theme === "light" ? "dark" : "light",
            })
          }
          disabled={!project}
        >
          {project?.ui.theme === "light" ? (
            <Moon size={18} />
          ) : (
            <Sun size={18} />
          )}
        </Tool>
        <Tool label="使用说明" onClick={() => setModal("help")}>
          <HelpCircle size={18} />
        </Tool>
      </header>
      {project && (
        <div className="command-bar">
          <div className="command-group">
            <Tool
              label="显示文件侧栏"
              active={sidebar}
              onClick={() => setSidebar(!sidebar)}
            >
              <Files size={18} />
            </Tool>
            <span className="toolbar-divider" />
            <button
              className="button"
              onClick={() => codeInput.current?.click()}
            >
              <FileCode2 size={15} />
              <span>上传代码</span>
            </button>
            <button
              className="button"
              onClick={() => svgInput.current?.click()}
            >
              <FileImage size={15} />
              <span>上传 SVG</span>
            </button>
            <button
              className="button"
              onClick={() =>
                void run(async () => {
                  captureCamera();
                  await flush();
                })
              }
            >
              <Save size={15} />
              <span>保存</span>
            </button>
          </div>
          <div className="command-group">
            <button
              className={`button bind-button ${pending ? "selecting" : "primary"}`}
              disabled={!project.svg}
              onClick={beginBinding}
            >
              {pending ? <X size={15} /> : <Link2 size={15} />}
              <span>{pending ? "取消框选" : "绑定代码与 SVG"}</span>
            </button>
            <button
              className="button export-button"
              onClick={() => void run(exportZip)}
            >
              <Download size={15} />
              <span>导出项目</span>
            </button>
          </div>
        </div>
      )}
      {(saveState === "error" || saveState === "conflict") && (
        <div className="save-error">
          <AlertCircle size={16} />
          <span>{saveError}</span>
          <button onClick={() => void run(exportZip)}>导出本地副本</button>
          {saveState === "error" ? (
            <button onClick={() => void run(flush)}>重试保存</button>
          ) : (
            <button
              onClick={() =>
                setConfirmation({
                  message:
                    "重新加载将放弃此页面尚未保存的修改。请先导出本地副本。",
                  run: () =>
                    void run(async () => {
                      load(await api<Project>(`/projects/${project!.id}`));
                      setInspector(false);
                    }),
                })
              }
            >
              重新加载
            </button>
          )}
        </div>
      )}
      {loading ? (
        <main className="welcome">
          <LoaderCircle className="spin" size={26} />
          <p>正在打开工作空间…</p>
        </main>
      ) : !project ? (
        <main className="welcome">
          <div className="welcome-symbol">
            <Code2 size={32} />
            <ArrowLeftRight size={25} />
            <ScanLine size={32} />
          </div>
          <h1>代码与结构，连起来看。</h1>
          <p>
            创建项目，添加 Python 和 SVG，
            <br />
            把每一段计算与网络中的区域对应起来。
          </p>
          <div className="welcome-actions">
            <button
              className="button primary"
              onClick={() => {
                setDraft("");
                setModal("projects");
              }}
            >
              <Plus size={17} />
              创建项目
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(() => createProject("attention"))}
            >
              <BookOpen size={17} />
              打开 Attention 示例
            </button>
          </div>
          <button
            className="text-button"
            onClick={() => zipInput.current?.click()}
          >
            <Upload size={14} />
            导入已有项目 ZIP
          </button>
        </main>
      ) : (
        <main className="workbench">
          <nav className="activity-bar">
            <Tool
              label="项目文件"
              active={sidebar && sideTab === "files"}
              onClick={() => {
                setSideTab("files");
                setSidebar(sideTab !== "files" || !sidebar);
              }}
            >
              <Files size={21} />
            </Tool>
            <Tool
              label="所有绑定"
              active={sidebar && sideTab === "bindings"}
              onClick={() => {
                setSideTab("bindings");
                setSidebar(sideTab !== "bindings" || !sidebar);
              }}
            >
              <Link2 size={21} />
            </Tool>
            <Tool label="全局搜索" onClick={() => setModal("search")}>
              <Search size={21} />
            </Tool>
            <span className="activity-spacer" />
            <Tool
              label="项目管理"
              onClick={() => {
                setDraft("");
                setModal("projects");
              }}
            >
              <FolderOpen size={20} />
            </Tool>
          </nav>
          {sidebar && (
            <aside className="sidebar">
              <header>
                <span>{sideTab === "files" ? "资源管理器" : "绑定关系"}</span>
                <Tool label="收起侧栏" onClick={() => setSidebar(false)}>
                  <PanelLeftClose size={15} />
                </Tool>
              </header>
              <div className="sidebar-project">
                <FolderOpen size={15} />
                <strong>{project.name}</strong>
                <Tool
                  label="重命名项目"
                  onClick={() => {
                    setDraft(project.name);
                    setModal("rename-project");
                  }}
                >
                  <Pencil size={13} />
                </Tool>
              </div>
              {sideTab === "files" && (
                <>
                  <div className="section-label">
                    <span>
                      源代码 <em>{project.files.length}</em>
                    </span>
                    <Tool
                      label="新建代码文件"
                      onClick={() => {
                        setDraft("model.py");
                        setModal("new-file");
                      }}
                    >
                      <Plus size={15} />
                    </Tool>
                  </div>
                  <div className="file-tree">
                    {project.files.map((f) => (
                      <button
                        key={f.id}
                        className={`file-row ${f.id === activeFile?.id ? "active" : ""}`}
                        onClick={() => selectFile(f.id)}
                      >
                        <FileCode2 size={15} />
                        <span>{f.name}</span>
                        <em>
                          {project.bindings.filter(
                            (b) => b.code.file === f.name,
                          ).length || ""}
                        </em>
                      </button>
                    ))}
                  </div>
                  <div className="section-label">网络结构</div>
                  <button
                    className="file-row svg-file"
                    onClick={() => updateUI({ portraitTab: "svg" })}
                  >
                    <FileImage size={15} />
                    <span>{project.svg?.name || "尚未上传 SVG"}</span>
                  </button>
                </>
              )}
              <div className="section-label">
                <span>
                  绑定 <em>{project.bindings.length}</em>
                </span>
                <Tool
                  label="新建绑定"
                  disabled={!project.svg}
                  onClick={beginBinding}
                >
                  <Plus size={15} />
                </Tool>
              </div>
              <div className="binding-list">
                {project.bindings.map((b, i) => (
                  <div
                    className={`binding-row ${b.id === selected?.id ? "active" : ""}`}
                    key={b.id}
                  >
                    <button onClick={() => activate(b.id)}>
                      <span
                        className="binding-index"
                        style={{ color: b.color }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="binding-info">
                        <strong>{b.name || "未命名绑定"}</strong>
                        <small>
                          {b.code.file} ·{" "}
                          {b.code.startLine === b.code.endLine
                            ? `L${b.code.startLine}`
                            : `L${b.code.startLine}–${b.code.endLine}`}
                        </small>
                      </span>
                    </button>
                    <Tool
                      label={`删除绑定 ${b.name}`}
                      className="row-delete"
                      onClick={() => removeBinding(b)}
                    >
                      <X size={12} />
                    </Tool>
                  </div>
                ))}
                {!project.bindings.length && (
                  <p className="sidebar-empty">
                    选择代码，再框选 SVG
                    <br />
                    创建第一个绑定。
                  </p>
                )}
              </div>
              <div className="sidebar-footer">
                <span className="subtle">存储位置</span>
                <span>
                  <Check size={12} />
                  服务器 · 自动保存
                </span>
              </div>
            </aside>
          )}
          <div
            ref={workspace}
            className={`split-workspace tab-${project.ui.portraitTab}`}
            style={{ "--split": `${project.ui.split}%` } as React.CSSProperties}
          >
            <div className="portrait-tabs">
              <button
                className={project.ui.portraitTab === "code" ? "active" : ""}
                onClick={() => updateUI({ portraitTab: "code" })}
              >
                <Code2 size={16} />
                代码
              </button>
              <button
                className={project.ui.portraitTab === "svg" ? "active" : ""}
                onClick={() => updateUI({ portraitTab: "svg" })}
              >
                <ScanLine size={16} />
                结构图{pending && <span className="pending-dot" />}
              </button>
            </div>
            <section className="code-pane">
              <div className="pane-toolbar">
                <div className="file-tabs">
                  {project.files.map((f) => (
                    <button
                      key={f.id}
                      className={f.id === activeFile?.id ? "active" : ""}
                      onClick={() => selectFile(f.id)}
                    >
                      <span className="python-mark">py</span>
                      {f.name}
                    </button>
                  ))}
                </div>
                <Tool
                  label="新建文件"
                  onClick={() => {
                    setDraft("new_model.py");
                    setModal("new-file");
                  }}
                >
                  <Plus size={15} />
                </Tool>
                <Tool
                  label="查找代码 Ctrl+F"
                  onClick={() => editor.current?.search()}
                >
                  <Search size={15} />
                </Tool>
              </div>
              <div className="editor-breadcrumb">
                <span>
                  源代码 / <strong>{activeFile?.name}</strong>
                </span>
                <span>
                  <Tool
                    label="重命名文件"
                    onClick={() => {
                      setDraft(activeFile?.name || "");
                      setModal("rename-file");
                    }}
                  >
                    <Pencil size={13} />
                  </Tool>
                  <Tool label="删除文件" onClick={removeFile}>
                    <Trash2 size={13} />
                  </Tool>
                </span>
              </div>
              {activeFile && (
                <CodeEditor
                  key={`${project.id}:${activeFile.id}`}
                  ref={editor}
                  file={activeFile}
                  bindings={project.bindings}
                  selectedId={selected?.id || null}
                  theme={project.ui.theme}
                  savedView={project.ui.editorViews[activeFile.id]}
                  onChange={updateCode}
                  onSelection={onSelection}
                  onView={editorView}
                  onActivate={(id) => {
                    if (!pending) activate(id, "code");
                  }}
                />
              )}
              <div className="pane-footer">
                <span>Python</span>
                <span>
                  {selection
                    ? `第 ${selection.startLine}${selection.startLine === selection.endLine ? "" : `–${selection.endLine}`} 行`
                    : "选择代码后可绑定"}
                </span>
                <span>UTF-8</span>
              </div>
            </section>
            <div
              className="splitter"
              role="separator"
              aria-label="调整代码与 SVG 宽度"
              aria-orientation="vertical"
              aria-valuemin={22}
              aria-valuemax={78}
              aria-valuenow={project.ui.split}
              tabIndex={0}
              onPointerDown={splitterDown}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  updateUI({
                    split: Math.max(
                      22,
                      Math.min(
                        78,
                        project.ui.split + (e.key === "ArrowRight" ? 2 : -2),
                      ),
                    ),
                  });
                }
              }}
            >
              <span />
            </div>
            <section className="graph-pane">
              <div className="pane-toolbar graph-title">
                <span>
                  <FileImage size={15} />
                  {project.svg?.name || "网络结构图"}
                </span>
                <div>
                  <Tool
                    label="在 SVG 中显示代码"
                    active={project.ui.showCode}
                    disabled={!project.svg}
                    onClick={() => updateUI({ showCode: !project.ui.showCode })}
                  >
                    <Code2 size={16} />
                  </Tool>
                  <Tool
                    label="绑定详情与备注"
                    active={inspector}
                    disabled={!selected}
                    onClick={() => setInspector(!inspector)}
                  >
                    <Settings2 size={16} />
                  </Tool>
                </div>
              </div>
              <div className="view-toolbar">
                <div>
                  <Tool
                    label="缩小"
                    disabled={!project.svg}
                    onClick={() => viewer.current?.zoom(1 / 1.2)}
                  >
                    <ZoomOut size={16} />
                  </Tool>
                  <button
                    className="zoom-value"
                    onClick={() => viewer.current?.fit("actual")}
                    disabled={!project.svg}
                    title="恢复 100%"
                  >
                    <span ref={zoomLabel}>100%</span>
                  </button>
                  <Tool
                    label="放大"
                    disabled={!project.svg}
                    onClick={() => viewer.current?.zoom(1.2)}
                  >
                    <ZoomIn size={16} />
                  </Tool>
                  <span className="toolbar-divider" />
                  <button
                    className="button small"
                    disabled={!project.svg}
                    onClick={() => viewer.current?.fit("window")}
                  >
                    <Maximize size={14} />
                    <span>适应窗口</span>
                  </button>
                  <button
                    className="button small"
                    disabled={!project.svg}
                    onClick={() => viewer.current?.fit("width")}
                  >
                    适应宽度
                  </button>
                  <Tool
                    label="重置视图"
                    disabled={!project.svg}
                    onClick={() => {
                      updateUI({ camera: null });
                      viewer.current?.fit("width");
                    }}
                  >
                    <RotateCcw size={14} />
                  </Tool>
                </div>
                <span className="overlay-count">
                  {project.bindings.length} 个绑定
                </span>
              </div>
              {pending && (
                <div className="binding-banner">
                  <ScanLine size={15} />
                  <span>
                    框选区域 → {pending.range.file} : {pending.range.startLine}–
                    {pending.range.endLine}
                  </span>
                </div>
              )}
              <SvgViewer
                key={project.id}
                ref={viewer}
                svg={project.svg}
                bindings={project.bindings}
                files={project.files}
                selectedId={selected?.id || null}
                showCode={project.ui.showCode}
                camera={project.ui.camera}
                selecting={!!pending}
                onRegion={createRegion}
                onActivate={(id) => activate(id, "svg")}
                onCamera={(camera) => updateUI({ camera })}
                onScale={(scale) => {
                  if (zoomLabel.current)
                    zoomLabel.current.textContent = `${(scale * 100).toFixed(scale < 0.1 ? 1 : 0)}%`;
                }}
                onUpload={() => svgInput.current?.click()}
                onError={notify}
                onCancel={() => setPending(null)}
              />
              {selected && (
                <div className="selected-strip">
                  <span
                    className="color-dot"
                    style={{ background: selected.color }}
                  />
                  <strong>{selected.name}</strong>
                  <span>
                    {selected.code.file} : {selected.code.startLine}–
                    {selected.code.endLine}
                  </span>
                  <button onClick={() => setInspector(!inspector)}>
                    <BookOpen size={14} />
                    {inspector ? "收起详情" : "详情 / 备注"}
                  </button>
                </div>
              )}
              {selected && inspector && (
                <BindingInspector
                  key={selected.id}
                  binding={selected}
                  files={project.files}
                  onChange={editBinding}
                  onReselect={() => {
                    setPending({ range: selected.code, id: selected.id });
                    setInspector(false);
                    updateUI({ portraitTab: "svg" });
                  }}
                  onDelete={() => removeBinding(selected)}
                  onClose={() => setInspector(false)}
                />
              )}
            </section>
          </div>
        </main>
      )}
      <footer className="statusbar">
        <div>
          <ArrowLeftRight size={13} />
          <span>
            {pending
              ? "绑定模式 · 在 SVG 上拖动框选"
              : selected
                ? `${selected.code.file} L${selected.code.startLine}–${selected.code.endLine} ↔ ${selected.name}`
                : "就绪 · 选择代码，框选结构，建立连接"}
          </span>
        </div>
        <div>
          <span className="desktop-status">
            {project
              ? `${project.files.length} 文件 · ${project.bindings.length} 绑定`
              : "CodeFlowGraph"}
          </span>
          <span>SVG 原始坐标</span>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal === "projects" && (
        <Dialog title="项目管理" wide onClose={() => setModal(null)}>
          <div className="project-create">
            <label>
              新项目名称
              <input
                autoFocus
                placeholder="例如：Transformer、UNet、ResNet18"
                value={draft}
                maxLength={150}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !busy)
                    void run(() => createProject());
                }}
              />
            </label>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void run(() => createProject())}
            >
              <Plus size={16} />
              创建
            </button>
          </div>
          <div className="project-utilities">
            <button
              className="button"
              disabled={busy}
              onClick={() => zipInput.current?.click()}
            >
              <Upload size={15} />
              导入 ZIP
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void run(() => createProject("attention"))}
            >
              <BookOpen size={15} />
              创建 Attention 示例
            </button>
          </div>
          <div className="project-list">
            {projects.map((summary) => (
              <div
                key={summary.id}
                className={`project-item ${summary.id === project?.id ? "active" : ""}`}
              >
                <FolderOpen size={22} />
                <button
                  disabled={busy}
                  onClick={() => void run(() => openProject(summary.id))}
                >
                  <strong>
                    {summary.id === project?.id ? project.name : summary.name}
                  </strong>
                  <small>
                    {summary.fileCount} 个文件 · {summary.bindingCount} 个绑定 ·{" "}
                    {new Date(summary.updatedAt).toLocaleDateString("zh-CN")}
                  </small>
                </button>
                {summary.id === project?.id && (
                  <span className="badge">当前</span>
                )}
                <Tool
                  label={`删除项目 ${summary.name}`}
                  onClick={() =>
                    setConfirmation({
                      message: `永久删除项目“${summary.name}”及其中所有代码、SVG 和绑定？`,
                      run: () =>
                        void run(async () => {
                          if (current.current?.id === summary.id) await flush();
                          await api(`/projects/${summary.id}`, {
                            method: "DELETE",
                          });
                          if (current.current?.id === summary.id) {
                            load(null);
                            setInspector(false);
                          }
                          await refreshList();
                        }),
                    })
                  }
                >
                  <Trash2 size={16} />
                </Tool>
              </div>
            ))}
            {!projects.length && (
              <p className="empty-message">
                还没有项目。可以新建，或从 Attention 示例开始。
              </p>
            )}
          </div>
        </Dialog>
      )}
      {(modal === "new-file" ||
        modal === "rename-file" ||
        modal === "rename-project") && (
        <Dialog
          title={
            modal === "new-file"
              ? "新建代码文件"
              : modal === "rename-file"
                ? "重命名代码文件"
                : "重命名项目"
          }
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (modal === "rename-project") {
                if (draft.trim()) {
                  update((p) => ({ ...p, name: draft.trim() }));
                  setModal(null);
                }
              } else writeFileName();
            }}
          >
            <label>
              {modal === "rename-project" ? "项目名称" : "Python 文件名"}
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={150}
                required
              />
            </label>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button className="button primary" type="submit">
                保存
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal === "search" && (
        <Dialog title="全局搜索" wide onClose={() => setModal(null)}>
          <div className="search-input">
            <Search size={19} />
            <input
              autoFocus
              placeholder="搜索代码、SVG 文字、绑定名称或备注…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="search-results">
            {results.map((r) => (
              <button
                key={r.key}
                onClick={() => {
                  r.go();
                  setModal(null);
                }}
              >
                <span className="result-type">{r.type}</span>
                <span>
                  <strong>{r.title}</strong>
                  <small>{r.detail}</small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {!term ? (
              <p className="empty-message">
                例如：LayerNorm、qkv、self.attention
              </p>
            ) : !results.length ? (
              <p className="empty-message">没有找到匹配结果</p>
            ) : (
              <div className="result-count">
                {results.length} 条结果
                {results.length >= 160 ? "（结果已限制，请缩小搜索范围）" : ""}
              </div>
            )}
          </div>
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog title="使用 CodeFlowGraph" wide onClose={() => setModal(null)}>
          <div className="help-content">
            <ol>
              <li>
                <strong>添加文件</strong>
                <p>
                  创建项目，上传一个或多个 .py 文件，再上传网络结构的
                  SVG。可以使用 Attention 示例练习。
                </p>
              </li>
              <li>
                <strong>建立绑定</strong>
                <p>
                  在编辑器选择一行或多行，点击“绑定代码与
                  SVG”，在结构图上拖出一个矩形。无需 SVG
                  节点本身可点击。平板可直接触摸框选。
                </p>
              </li>
              <li>
                <strong>双向跳转</strong>
                <p>
                  点击已绑定代码或左侧圆点定位结构图；点击结构图的绑定区域定位代码。同一行有多个绑定时，重复点击可轮流跳转。
                </p>
              </li>
              <li>
                <strong>编辑与备注</strong>
                <p>
                  绑定详情中可修改行号、颜色、重新框选，并编写 Markdown / LaTeX
                  备注。启用“在 SVG 中显示代码”后，代码注释会和结构图一起缩放。
                </p>
              </li>
            </ol>
            <table>
              <tbody>
                <tr>
                  <td>拖动 / 单指拖动</td>
                  <td>平移结构图</td>
                </tr>
                <tr>
                  <td>滚轮 / 双指捏合</td>
                  <td>以指针 / 手势中心缩放</td>
                </tr>
                <tr>
                  <td>Alt + 滚轮 / 右侧滚动条</td>
                  <td>上下浏览长 SVG</td>
                </tr>
                <tr>
                  <td>Shift + 滚轮 / 底部滚动条</td>
                  <td>左右浏览</td>
                </tr>
                <tr>
                  <td>Ctrl / ⌘ + F</td>
                  <td>查找当前代码文件</td>
                </tr>
                <tr>
                  <td>Ctrl / ⌘ + K</td>
                  <td>全局搜索</td>
                </tr>
                <tr>
                  <td>Ctrl / ⌘ + S</td>
                  <td>立即保存</td>
                </tr>
                <tr>
                  <td>方向键 / Page Up / Page Down</td>
                  <td>画布获得焦点后移动视图</td>
                </tr>
              </tbody>
            </table>
            <p className="muted">
              更改会在停止操作后自动保存到服务器。关闭前请确认显示“已保存”。可以导出完整
              ZIP
              备份，再导入到其他服务器。多页面同时编辑时会提示保存冲突，先导出本地副本后再重新加载。
            </p>
          </div>
        </Dialog>
      )}
      {confirmation && (
        <Dialog title="确认操作" onClose={() => setConfirmation(null)}>
          <p className="confirmation-message">{confirmation.message}</p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setConfirmation(null)}>
              取消
            </button>
            <button
              className="button danger-solid"
              onClick={() => {
                const action = confirmation.run;
                setConfirmation(null);
                action();
              }}
            >
              确认
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
