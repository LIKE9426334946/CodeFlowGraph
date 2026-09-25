import { useMemo, useState } from "react";
import { marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";
import { ScanLine, Trash2, X } from "lucide-react";
import type { Binding, SourceFile } from "../types";
import { COLORS } from "../types";

export function Markdown({ source }: { source: string }) {
  const html = useMemo(() => {
    const math: { source: string; display: boolean }[] = [];
    const text = source.replace(
      /\$\$([\s\S]+?)\$\$|(?<!\\)\$([^\n$]+?)\$/g,
      (_, block, inline) => {
        math.push({ source: block || inline, display: !!block });
        return `CFGMATHPLACEHOLDER${math.length - 1}END`;
      },
    );
    let result = DOMPurify.sanitize(
      marked.parse(text, { async: false }) as string,
    );
    result = result.replace(/CFGMATHPLACEHOLDER(\d+)END/g, (match, i) => {
      const m = math[Number(i)];
      return m
        ? katex.renderToString(m.source, {
            displayMode: m.display,
            throwOnError: false,
            trust: false,
            strict: "ignore",
            maxExpand: 1000,
            maxSize: 20,
          })
        : match;
    });
    return result;
  }, [source]);
  return (
    <div
      className="markdown"
      dangerouslySetInnerHTML={{
        __html:
          html ||
          '<p class="muted">还没有备注。切换到编辑，记录形状变化、计算公式或阅读心得。</p>',
      }}
    />
  );
}
export function BindingInspector({
  binding,
  files,
  onChange,
  onReselect,
  onDelete,
  onClose,
}: {
  binding: Binding;
  files: SourceFile[];
  onChange: (binding: Binding) => void;
  onReselect: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"details" | "note" | "preview">("details");
  const lines =
    files.find((f) => f.name === binding.code.file)?.content.split("\n")
      .length || 1;
  return (
    <section className="inspector" aria-label="绑定详情">
      <header>
        <div className="segmented">
          <button
            className={tab === "details" ? "active" : ""}
            onClick={() => setTab("details")}
          >
            绑定设置
          </button>
          <button
            className={tab === "note" ? "active" : ""}
            onClick={() => setTab("note")}
          >
            编辑备注
          </button>
          <button
            className={tab === "preview" ? "active" : ""}
            onClick={() => setTab("preview")}
          >
            预览公式
          </button>
        </div>
        <button
          className="icon-button"
          aria-label="关闭绑定详情"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      {tab === "details" ? (
        <div className="inspector-fields">
          <label>
            名称
            <input
              aria-label="绑定名称"
              value={binding.name}
              onChange={(e) => onChange({ ...binding, name: e.target.value })}
              maxLength={200}
            />
          </label>
          <div className="range-fields">
            <label>
              代码文件
              <select
                value={binding.code.file}
                onChange={(e) =>
                  onChange({
                    ...binding,
                    code: { file: e.target.value, startLine: 1, endLine: 1 },
                  })
                }
              >
                {files.map((f) => (
                  <option key={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
            <label>
              起始行
              <input
                aria-label="起始行"
                type="number"
                min={1}
                max={lines}
                value={binding.code.startLine}
                onChange={(e) => {
                  const n = Math.max(
                    1,
                    Math.min(lines, Number(e.target.value)),
                  );
                  onChange({
                    ...binding,
                    code: {
                      ...binding.code,
                      startLine: n,
                      endLine: Math.max(n, binding.code.endLine),
                    },
                  });
                }}
              />
            </label>
            <label>
              结束行
              <input
                aria-label="结束行"
                type="number"
                min={binding.code.startLine}
                max={lines}
                value={binding.code.endLine}
                onChange={(e) => {
                  const n = Math.max(
                    binding.code.startLine,
                    Math.min(lines, Number(e.target.value)),
                  );
                  onChange({
                    ...binding,
                    code: { ...binding.code, endLine: n },
                  });
                }}
              />
            </label>
          </div>
          <div className="binding-options">
            <div className="color-options">
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`颜色 ${c}`}
                  aria-pressed={binding.color === c}
                  style={{ background: c }}
                  onClick={() => onChange({ ...binding, color: c })}
                />
              ))}
            </div>
            <button className="button small" onClick={onReselect}>
              <ScanLine size={14} />
              重新框选
            </button>
            <button
              className="icon-button danger"
              aria-label="删除当前绑定"
              onClick={onDelete}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="region-coordinates">
            SVG 坐标 · X {binding.svgRegion.x.toFixed(1)} · Y{" "}
            {binding.svgRegion.y.toFixed(1)} ·{" "}
            {binding.svgRegion.width.toFixed(1)} ×{" "}
            {binding.svgRegion.height.toFixed(1)}
          </div>
          <details className="annotation-settings">
            <summary>代码注释的位置</summary>
            <div className="range-fields">
              <label>
                X
                <input
                  aria-label="注释 X"
                  type="number"
                  value={
                    binding.annotation?.x ??
                    binding.svgRegion.x + binding.svgRegion.width + 42
                  }
                  onChange={(e) =>
                    onChange({
                      ...binding,
                      annotation: {
                        x: Number(e.target.value),
                        y: binding.annotation?.y ?? binding.svgRegion.y,
                      },
                    })
                  }
                />
              </label>
              <label>
                Y
                <input
                  aria-label="注释 Y"
                  type="number"
                  value={binding.annotation?.y ?? binding.svgRegion.y}
                  onChange={(e) =>
                    onChange({
                      ...binding,
                      annotation: {
                        x:
                          binding.annotation?.x ??
                          binding.svgRegion.x + binding.svgRegion.width + 42,
                        y: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <button
                className="button small"
                onClick={() => onChange({ ...binding, annotation: undefined })}
              >
                重置位置
              </button>
            </div>
          </details>
        </div>
      ) : tab === "note" ? (
        <div className="note-editor">
          <textarea
            aria-label="Markdown 备注"
            placeholder={
              "### 模块名称\n\n写下你的理解，支持 Markdown 和 $LaTeX$。"
            }
            value={binding.note}
            onChange={(e) => onChange({ ...binding, note: e.target.value })}
          />
          <span>Markdown · 行内公式 $…$ · 独立公式 $$…$$ · 自动保存</span>
        </div>
      ) : (
        <div className="note-preview">
          <Markdown source={binding.note} />
        </div>
      )}
    </section>
  );
}
