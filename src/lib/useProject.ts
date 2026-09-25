import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../types";
import { api, ApiError } from "./api";

export function useProject() {
  const [project, setProject] = useState<Project | null>(null);
  const current = useRef<Project | null>(null);
  const savedSnapshot = useRef<Project | null>(null);
  const [saveState, setSaveState] = useState<
    "saved" | "pending" | "saving" | "error" | "conflict"
  >("saved");
  const [saveError, setSaveError] = useState("");
  const generation = useRef(0),
    savedGeneration = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flight = useRef<Promise<void> | null>(null);
  const conflict = useRef(false);
  const update = useCallback((fn: (p: Project) => Project) => {
    if (!current.current) return;
    const next = fn(current.current);
    if (next === current.current) return;
    current.current = next;
    generation.current++;
    setProject(next);
    setSaveState(conflict.current ? "conflict" : "pending");
  }, []);
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (flight.current) {
      await flight.current;
    }
    if (conflict.current)
      throw new Error("保存冲突，请先导出本地副本并重新加载");
    if (!current.current || generation.current === savedGeneration.current)
      return;
    const work = async () => {
      while (current.current && generation.current > savedGeneration.current) {
        const snapshot = current.current;
        const g = generation.current;
        setSaveState("saving");
        try {
          const patch: Record<string, unknown> = {
            revision: snapshot.revision,
          };
          for (const key of ["name", "files", "svg", "bindings", "ui"] as const)
            if (snapshot[key] !== savedSnapshot.current?.[key])
              patch[key] = snapshot[key];
          const result = await api<{ revision: number; updatedAt: string }>(
            `/projects/${snapshot.id}`,
            { method: "PATCH", body: JSON.stringify(patch) },
          );
          if (current.current?.id !== snapshot.id) return;
          current.current = { ...current.current, ...result };
          savedSnapshot.current = { ...snapshot, ...result };
          savedGeneration.current = g;
          setSaveState(generation.current === g ? "saved" : "pending");
          setSaveError("");
        } catch (error) {
          conflict.current = error instanceof ApiError && error.status === 409;
          setSaveState(conflict.current ? "conflict" : "error");
          setSaveError(error instanceof Error ? error.message : "保存失败");
          throw error;
        }
      }
    };
    flight.current = work();
    try {
      await flight.current;
    } finally {
      flight.current = null;
    }
  }, []);
  useEffect(() => {
    clearTimeout(timer.current);
    if (
      project &&
      !conflict.current &&
      generation.current > savedGeneration.current
    )
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, 750);
    return () => clearTimeout(timer.current);
  }, [project, flush]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generation.current > savedGeneration.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hide = () => {
      if (document.visibilityState === "hidden") void flush().catch(() => {});
    };
    const online = () => {
      void flush().catch(() => {});
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("online", online);
    };
  }, [flush]);
  const load = useCallback((p: Project | null) => {
    clearTimeout(timer.current);
    current.current = p;
    savedSnapshot.current = p;
    generation.current = 0;
    savedGeneration.current = 0;
    conflict.current = false;
    setProject(p);
    setSaveState("saved");
    setSaveError("");
  }, []);
  return { project, current, update, load, flush, saveState, saveError };
}
