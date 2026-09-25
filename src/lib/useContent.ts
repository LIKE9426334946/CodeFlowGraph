import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Content } from "../types";

export function useContent(editable: boolean) {
  const [content, setContent] = useState<Content | null>(null);
  const [status, setStatus] = useState<
    "saved" | "pending" | "saving" | "error"
  >("saved");
  const [error, setError] = useState("");
  const current = useRef<Content | null>(null),
    baseline = useRef<Content | null>(null);
  const generation = useRef(0),
    saved = useRef(0),
    flight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    let live = true,
      fetching = false;
    const refresh = async () => {
      if (fetching || !live) return;
      fetching = true;
      try {
        if (current.current) {
          const state = await api<{ revision: number }>("/state");
          if (state.revision === current.current.revision) {
            if (live) setError("");
            return;
          }
        }
        const p = await api<Content>("/content");
        if (live) {
          current.current = p;
          baseline.current = p;
          setContent(p);
          setError("");
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const focus = () => {
      if (!editable) void refresh();
    };
    const interval = !editable
      ? setInterval(() => {
          if (document.visibilityState === "visible") void refresh();
        }, 3000)
      : undefined;
    window.addEventListener("focus", focus);
    return () => {
      live = false;
      clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [editable]);
  const update = useCallback(
    (patch: Partial<Pick<Content, "code" | "svg">>) => {
      if (!editable || !current.current) return;
      const p = { ...current.current, ...patch };
      current.current = p;
      generation.current++;
      setContent(p);
      setStatus("pending");
    },
    [editable],
  );
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!editable) return;
    if (flight.current) await flight.current;
    if (!current.current || saved.current === generation.current) return;
    const work = async () => {
      while (current.current && saved.current < generation.current) {
        const snapshot = current.current,
          g = generation.current;
        const patch: Record<string, unknown> = { revision: snapshot.revision };
        for (const key of ["code", "svg"] as const)
          if (snapshot[key] !== baseline.current?.[key])
            patch[key] = snapshot[key];
        setStatus("saving");
        try {
          const result = await api<{ revision: number; updatedAt: string }>(
            "/content",
            { method: "PATCH", body: JSON.stringify(patch) },
          );
          current.current = { ...current.current, ...result };
          baseline.current = { ...snapshot, ...result };
          saved.current = g;
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
  }, [editable]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (editable && generation.current > saved.current)
      timer.current = setTimeout(() => void flush().catch(() => {}), 750);
    return () => clearTimeout(timer.current);
  }, [content, editable, flush]);
  useEffect(() => {
    if (!editable) return;
    const leave = (event: BeforeUnloadEvent) => {
      if (generation.current > saved.current) {
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
  }, [editable, flush]);
  return { content, update, flush, status, error };
}
