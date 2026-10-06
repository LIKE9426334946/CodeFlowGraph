import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Image,
  Lock,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { Content, FolderInput, Gallery } from "../types";

type Props = {
  gallery: Gallery;
  folderId: string | null;
  current: Content | null;
  admin: boolean;
  onOpen: (id: string) => Promise<void>;
  onAdd: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenFolder: (id: string) => Promise<void>;
  onCreateFolder: (input: FolderInput) => Promise<void>;
  onEditFolder: (
    id: string,
    revision: number,
    input: FolderInput,
  ) => Promise<void>;
  onDeleteFolder: (id: string, revision: number) => Promise<void>;
  onMove: (folderId: string) => Promise<void>;
};
type FolderDraft = FolderInput & { id?: string; revision?: number };
export function ImageLibrary({
  gallery,
  folderId,
  current,
  admin,
  onOpen,
  onAdd,
  onRename,
  onDelete,
  onOpenFolder,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  onMove,
}: Props) {
  const [renaming, setRenaming] = useState(false),
    [name, setName] = useState("");
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [moving, setMoving] = useState(false),
    [destination, setDestination] = useState("");
  const selected = gallery.folders.find((folder) => folder.id === folderId);
  useEffect(() => {
    setRenaming(false);
    setMoving(false);
  }, [current?.id, current?.folderId]);
  useEffect(() => {
    setDraft(null);
  }, [folderId]);
  return (
    <section className="image-library" aria-label="已保存图片">
      <div className="library-heading">
        <strong>目录</strong>
        <small>{gallery.folders.length}</small>
      </div>
      {admin && (
        <button
          className="button library-add"
          aria-label="新增目录"
          onClick={() => setDraft({ name: "", description: "" })}
        >
          <FolderPlus size={17} />
          <span>新增目录</span>
        </button>
      )}
      {admin && draft && (
        <form
          className="image-name-form folder-form"
          aria-label={draft.id ? "编辑目录" : "新增目录"}
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const input = {
                name: draft.name.trim(),
                description: draft.description.trim(),
              };
              if (draft.id)
                await onEditFolder(draft.id, draft.revision!, input);
              else await onCreateFolder(input);
              setDraft(null);
            } catch {
              /* Keep the draft; the page shows the save error. */
            }
          }}
        >
          <label htmlFor="folder-name">目录名称</label>
          <input
            id="folder-name"
            autoFocus
            maxLength={150}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label htmlFor="folder-description">简短说明（选填）</label>
          <textarea
            id="folder-description"
            rows={3}
            maxLength={200}
            value={draft.description}
            placeholder="例如：经典图像分割网络"
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
          <div>
            <button
              className="button primary"
              type="submit"
              disabled={!draft.name.trim()}
            >
              保存目录
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label="取消编辑目录"
              onClick={() => setDraft(null)}
            >
              <X size={16} />
            </button>
          </div>
        </form>
      )}
      <nav className="folder-list" aria-label="目录列表">
        {gallery.folders.map((folder) => {
          const images = gallery.images.filter(
            (image) => image.folderId === folder.id,
          );
          const active = folder.id === folderId;
          return (
            <div className="folder-group" key={folder.id}>
              <button
                className={`folder-item ${active ? "selected" : ""}`}
                aria-label={`打开目录：${folder.name}`}
                aria-expanded={active}
                title={folder.name}
                onClick={() => void onOpenFolder(folder.id).catch(() => {})}
              >
                {active ? (
                  <ChevronDown size={15} />
                ) : (
                  <ChevronRight size={15} />
                )}
                <span>{folder.name}</span>
                <small>{images.length}</small>
              </button>
              {active && (
                <div className="folder-content">
                  {folder.description && (
                    <p className="folder-description">{folder.description}</p>
                  )}
                  <nav className="image-list" aria-label="图片列表">
                    {images.map((image) => (
                      <button
                        key={image.id}
                        className={`image-item ${image.id === current?.id ? "selected" : ""}`}
                        title={`${image.name} · ${image.labelCount} 个标签${image.locked ? " · 已锁定" : ""}`}
                        aria-label={`打开图片：${image.name}`}
                        aria-pressed={image.id === current?.id}
                        onClick={() => void onOpen(image.id).catch(() => {})}
                      >
                        {admin && image.locked ? (
                          <Lock size={15} aria-label="图片已锁定" />
                        ) : (
                          <Image size={15} />
                        )}
                        <span>{image.name}</span>
                      </button>
                    ))}
                    {!images.length && (
                      <p className="library-empty">此目录暂无图片</p>
                    )}
                  </nav>
                </div>
              )}
            </div>
          );
        })}
        {!gallery.folders.length && (
          <p className="library-empty">{admin ? "请先新增目录" : "暂无目录"}</p>
        )}
      </nav>
      {admin && selected && (
        <div className="image-manage-actions folder-manage-actions">
          <button
            className="button"
            aria-label="编辑目录"
            title="修改目录名称和说明"
            onClick={() => setDraft({ ...selected })}
          >
            <Pencil size={14} />
            <span>编辑目录</span>
          </button>
          <button
            className="button delete-image"
            aria-label="删除目录"
            title="删除当前目录"
            onClick={() => {
              const count = gallery.images.filter(
                (image) => image.folderId === selected.id,
              ).length;
              const message = count
                ? `确定删除目录「${selected.name}」及其中的 ${count} 张图片和全部标签吗？此操作无法撤销。`
                : `确定删除空目录「${selected.name}」吗？`;
              if (window.confirm(message))
                void onDeleteFolder(selected.id, selected.revision).catch(
                  () => {},
                );
            }}
          >
            <Trash2 size={14} />
            <span>删除目录</span>
          </button>
        </div>
      )}
      {admin && (
        <button
          className="button library-add"
          aria-label="添加 SVG"
          title={selected ? `添加到「${selected.name}」` : "请先新增或选择目录"}
          disabled={!selected}
          onClick={onAdd}
        >
          <Plus size={17} />
          <span>添加 SVG</span>
        </button>
      )}
      {admin && current && (
        <>
          {renaming ? (
            <form
              className="image-name-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await onRename(name.trim());
                  setRenaming(false);
                } catch {
                  /* The page shows the save error. */
                }
              }}
            >
              <label htmlFor="image-name">图片名称</label>
              <input
                id="image-name"
                value={name}
                autoFocus
                maxLength={150}
                onChange={(e) => setName(e.target.value)}
              />
              <div>
                <button
                  className="button primary"
                  type="submit"
                  disabled={!name.trim()}
                >
                  保存名称
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="取消重命名"
                  onClick={() => setRenaming(false)}
                >
                  <X size={16} />
                </button>
              </div>
            </form>
          ) : (
            <div className="image-manage-actions">
              <button
                className="button"
                aria-label="重命名图片"
                title="重命名图片"
                onClick={() => {
                  setName(current.name);
                  setRenaming(true);
                }}
              >
                <Pencil size={15} />
                <span>命名</span>
              </button>
              <button
                className="button delete-image"
                aria-label="删除图片"
                title="删除图片"
                onClick={() => {
                  if (
                    window.confirm(
                      `确定删除「${current.name}」及其全部标签吗？`,
                    )
                  )
                    void onDelete().catch(() => {});
                }}
              >
                <Trash2 size={15} />
                <span>删除</span>
              </button>
            </div>
          )}
          {moving ? (
            <form
              className="image-name-form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await onMove(destination);
                  setMoving(false);
                } catch {
                  /* The page shows the save error. */
                }
              }}
            >
              <label htmlFor="destination-folder">目标目录</label>
              <select
                id="destination-folder"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              >
                {gallery.folders
                  .filter((folder) => folder.id !== current.folderId)
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
              </select>
              <div>
                <button
                  className="button primary"
                  type="submit"
                  disabled={!destination}
                >
                  确认移动
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="取消移动图片"
                  onClick={() => setMoving(false)}
                >
                  <X size={16} />
                </button>
              </div>
            </form>
          ) : (
            gallery.folders.length > 1 && (
              <button
                className="button move-image"
                onClick={() => {
                  setDestination(
                    gallery.folders.find(
                      (folder) => folder.id !== current.folderId,
                    )!.id,
                  );
                  setMoving(true);
                }}
              >
                移动图片
              </button>
            )
          )}
        </>
      )}
    </section>
  );
}
