import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, blankProject } from "./store.js";
import { exportProject, importProject } from "./archive.js";
import { demoProject } from "./sample.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export function createApp(
  dataDir = process.env.DATA_DIR || path.join(here, "..", "data"),
) {
  const app = express();
  const store = createStore(dataDir);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      let foreign = false;
      try {
        foreign = !!origin && new URL(origin).host !== req.get("host");
      } catch {
        foreign = true;
      }
      if (req.get("sec-fetch-site") === "cross-site" || foreign)
        return res.status(403).json({ error: "不允许跨站写入" });
    }
    next();
  });
  app.use(
    "/api/projects/import",
    express.raw({
      type: ["application/zip", "application/octet-stream"],
      limit: "40mb",
    }),
  );
  app.use(express.json({ limit: "48mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, name: "CodeFlowGraph" }),
  );
  app.get("/api/bootstrap", async (_req, res) =>
    res.json({ projects: await store.list(), ...(await store.workspace()) }),
  );
  app.put("/api/workspace", async (req, res) => {
    await store.setWorkspace(req.body.activeProjectId);
    res.json({ ok: true });
  });
  app.post("/api/projects/import", async (req, res) => {
    const project = await store.create(await importProject(req.body));
    await store.setWorkspace(project.id);
    res.status(201).json(project);
  });
  app.post("/api/projects", async (req, res) => {
    const project = await store.create(
      req.body.template === "attention"
        ? demoProject(req.body.name)
        : blankProject(req.body.name),
    );
    await store.setWorkspace(project.id);
    res.status(201).json(project);
  });
  // Local conflict recovery can export the current browser snapshot without overwriting the server.
  app.post("/api/export", async (req, res) => {
    const { validateProject } = await import("./store.js");
    res
      .type("application/zip")
      .send(await exportProject(validateProject(req.body)));
  });
  app.get("/api/projects/:id/export", async (req, res) => {
    const p = await store.read(req.params.id);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(p.name)}.zip`,
    );
    res.type("application/zip").send(await exportProject(p));
  });
  app.get("/api/projects/:id", async (req, res) =>
    res.json(await store.read(req.params.id)),
  );
  app.put("/api/projects/:id", async (req, res) => {
    const p = await store.save(req.params.id, req.body);
    res.json({ revision: p.revision, updatedAt: p.updatedAt });
  });
  app.patch("/api/projects/:id", async (req, res) => {
    const p = await store.save(req.params.id, req.body, true);
    res.json({ revision: p.revision, updatedAt: p.updatedAt });
  });
  app.delete("/api/projects/:id", async (req, res) => {
    await store.remove(req.params.id);
    if ((await store.workspace()).activeProjectId === req.params.id)
      await store.setWorkspace(null);
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  app.use(
    express.static(path.join(here, "..", "dist"), { index: "index.html" }),
  );
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    res
      .status(status)
      .json({
        error:
          status === 413
            ? "文件过大，请使用更小的 SVG / ZIP 文件"
            : status >= 500
              ? "服务器保存失败，请稍后重试"
              : error.message,
      });
  });
  return app;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3046);
  createApp().listen(port, host, () =>
    console.log(`CodeFlowGraph: http://${host}:${port}`),
  );
}
