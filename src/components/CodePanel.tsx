import { Code2, Pencil, Trash2 } from "lucide-react";

type Props = {
  code: string;
  draft: string | null;
  canEdit: boolean;
  onEdit: () => void;
  onDraftChange: (code: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
};

export function CodePanel({
  code,
  draft,
  canEdit,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
}: Props) {
  return (
    <section className="code-panel" aria-label="图片代码">
      <div className="code-heading">
        <Code2 size={17} aria-hidden="true" />
        <strong>代码</strong>
        {canEdit && draft === null && (
          <>
            <button
              className="icon-button"
              aria-label="编辑代码"
              title="编辑代码"
              onClick={onEdit}
            >
              <Pencil size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="删除代码"
              title="删除代码"
              onClick={() => {
                if (window.confirm("确定删除这张图片的代码吗？")) onDelete();
              }}
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
      </div>
      {canEdit && draft !== null ? (
        <form
          className="code-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <textarea
            className="code-input"
            aria-label="代码内容"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            wrap="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoFocus
            dir="ltr"
            maxLength={200000}
            placeholder="在此输入或粘贴代码"
            onKeyDown={(event) => {
              const input = event.currentTarget;
              if (
                event.key === "Tab" &&
                !event.shiftKey &&
                input.selectionStart === input.selectionEnd
              ) {
                event.preventDefault();
                const caret = input.selectionStart;
                onDraftChange(
                  draft.slice(0, caret) + "\t" + draft.slice(caret),
                );
                requestAnimationFrame(() =>
                  input.setSelectionRange(caret + 1, caret + 1),
                );
              }
            }}
          />
          <div className="code-actions">
            <button className="button" type="button" onClick={onCancel}>
              取消
            </button>
            <button className="button primary" type="submit">
              保存代码
            </button>
          </div>
        </form>
      ) : (
        <div
          className="code-scroll"
          tabIndex={0}
          role="region"
          aria-label="代码阅读区域"
        >
          <pre dir="ltr">
            <code>{code}</code>
          </pre>
        </div>
      )}
    </section>
  );
}
