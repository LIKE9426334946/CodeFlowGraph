import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type {
  Content,
  Gallery,
  ImageSummary,
  SvgLabel,
  TextFile,
} from "../types";

type OpenResult = { gallery: Gallery; image: Content };
type SaveResult = { gallery: Gallery; image: ImageSummary };
export function useContent(beforeChange: () => void) {
  const [content, setContent] = useState<Content | null>(null);
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [status, setStatus] = useState<
    "saved" | "pending" | "saving" | "error"
  >("saved");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef<Content | null>(null),
    catalog = useRef<Gallery | null>(null);
  const generation = useRef(0),
    saved = useRef(0),
    epoch = useRef(0);
  const flight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editing = useRef(false),
    acting = useRef(false);
  const setCatalog = useCallback((value: Gallery) => {
    catalog.current = value;
    setGallery(value);
  }, []);
  const install = useCallback(
    (next: Gallery, image: Content | null) => {
      current.current = image;
      generation.current = saved.current = 0;
      editing.current = false;
      setContent(image);
      setCatalog(next);
      setStatus("saved");
      setError("");
    },
    [setCatalog],
  );
  useEffect(() => {
    let live = true,
      fetching = false;
    const refresh = async () => {
      if (
        fetching ||
        acting.current ||
        editing.current ||
        generation.current > saved.current
      )
        return;
      fetching = true;
      const startedAt = epoch.current,
        startedGeneration = generation.current;
      try {
        const next = await api<Gallery>("/gallery");
        if (next.revision === catalog.current?.revision) return;
        const old = current.current;
        const id =
          old && next.images.some((item) => item.id === old.id)
            ? old.id
            : next.activeImageId;
        const summary = next.images.find((item) => item.id === id);
        const image = !id
          ? null
          : old?.id === id && old.revision === summary?.revision
            ? old
            : await api<Content>(`/images/${id}`);
        if (
          live &&
          !acting.current &&
          !editing.current &&
          epoch.current === startedAt &&
          generation.current === startedGeneration &&
          generation.current === saved.current
        )
          install(next, image);
      } catch (e) {
        if (live && epoch.current === startedAt) setError((e as Error).message);
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const focus = () => {
      void refresh();
    };
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    window.addEventListener("focus", focus);
    return () => {
      live = false;
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [install]);
  const update = useCallback((labels: SvgLabel[]) => {
    if (!current.current) return;
    current.current = { ...current.current, labels };
    generation.current++;
    setContent(current.current);
    setStatus("pending");
  }, []);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (flight.current) return flight.current;
    if (!current.current || saved.current === generation.current) return;
    const work = async () => {
      while (current.current && saved.current < generation.current) {
        const snapshot = current.current,
          g = generation.current;
        setStatus("saving");
        try {
          // Always address the owning image. Switching never redirects a pending save.
          const result = await api<SaveResult>(`/images/${snapshot.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              revision: snapshot.revision,
              labels: snapshot.labels,
            }),
          });
          current.current = { ...current.current, ...result.image };
          saved.current = g;
          setContent(current.current);
          setCatalog(result.gallery);
          setStatus(g === generation.current ? "saved" : "pending");
          setError("");
        } catch (e) {
          setStatus("error");
          setError((e as Error).message);
          throw e;
        }
      }
    };
    flight.current = work();
    try {
      await flight.current;
    } finally {
      flight.current = null;
    }
  }, [setCatalog]);
  const runAction = useCallback(
    async (work: () => Promise<void>) => {
      if (acting.current) return;
      acting.current = true;
      epoch.current++;
      setBusy(true);
      try {
        beforeChange();
        await flush();
        await work();
        setError("");
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        acting.current = false;
        setBusy(false);
      }
    },
    [beforeChange, flush],
  );
  const open = useCallback(
    (id: string) =>
      runAction(async () => {
        const result = await api<OpenResult>("/gallery/open", {
          method: "POST",
          body: JSON.stringify({ id }),
        });
        install(result.gallery, result.image);
      }),
    [runAction, install],
  );
  const add = useCallback(
    (svg: TextFile) =>
      runAction(async () => {
        const result = await api<OpenResult>("/images", {
          method: "POST",
          body: JSON.stringify({ svg }),
        });
        install(result.gallery, result.image);
      }),
    [runAction, install],
  );
  const rename = useCallback(
    (name: string) =>
      runAction(async () => {
        const image = current.current;
        if (!image) return;
        const result = await api<SaveResult>(`/images/${image.id}`, {
          method: "PATCH",
          body: JSON.stringify({ revision: image.revision, name }),
        });
        install(result.gallery, { ...image, ...result.image });
      }),
    [runAction, install],
  );
  const remove = useCallback(
    () =>
      runAction(async () => {
        const image = current.current;
        if (!image) return;
        const result = await api<{ gallery: Gallery }>(`/images/${image.id}`, {
          method: "DELETE",
          body: JSON.stringify({ revision: image.revision }),
        });
        const next = result.gallery.activeImageId
          ? await api<Content>(`/images/${result.gallery.activeImageId}`)
          : null;
        install(result.gallery, next);
      }),
    [runAction, install],
  );
  useEffect(() => {
    clearTimeout(timer.current);
    if (generation.current > saved.current)
      timer.current = setTimeout(() => void flush().catch(() => {}), 750);
    return () => clearTimeout(timer.current);
  }, [content, flush]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (
        generation.current > saved.current ||
        editing.current ||
        acting.current
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden") void flush().catch(() => {});
    };
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        beforeChange();
        void flush().catch(() => {});
      }
    };
    const online = () => void flush().catch(() => {});
    window.addEventListener("beforeunload", leave);
    window.addEventListener("keydown", save);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("keydown", save);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [flush, beforeChange]);
  const setEditing = useCallback((value: boolean) => {
    editing.current = value;
  }, []);
  return {
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
  };
}
