import { useEffect, useState } from "react";
import { Image, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Content, Gallery } from "../types";

type Props = {
  gallery: Gallery;
  current: Content | null;
  admin: boolean;
  onOpen: (id: string) => Promise<void>;
  onAdd: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
};
export function ImageLibrary({
  gallery,
  current,
  admin,
  onOpen,
  onAdd,
  onRename,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState(false),
    [name, setName] = useState("");
  useEffect(() => {
    setRenaming(false);
  }, [current?.id]);
  return (
    <section className="image-library" aria-label="已保存图片">
      <div className="library-heading">
        <strong>图片</strong>
        <small>{gallery.images.length}</small>
      </div>
      {admin && (
        <button
          className="button library-add"
          aria-label="添加 SVG"
          title="添加 SVG"
          onClick={onAdd}
        >
          <Plus size={17} />
          <span>添加 SVG</span>
        </button>
      )}
      <nav className="image-list" aria-label="图片列表">
        {gallery.images.map((image) => (
          <button
            key={image.id}
            className={`image-item ${image.id === current?.id ? "selected" : ""}`}
            title={`${image.name} · ${image.labelCount} 个标签`}
            aria-label={`打开图片：${image.name}`}
            aria-pressed={image.id === current?.id}
            onClick={() => void onOpen(image.id).catch(() => {})}
          >
            <Image size={15} />
            <span>{image.name}</span>
          </button>
        ))}
        {!gallery.images.length && <p className="library-empty">暂无图片</p>}
      </nav>
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
        </>
      )}
    </section>
  );
}
