import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export function createApp(
  dataDir = process.env.DATA_DIR || path.join(here, "..", "data"),
) {
  const app = express(),
    store = createStore(dataDir);
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
      if (foreign || req.get("sec-fetch-site") === "cross-site")
        return res.status(403).json({ error: "不允许跨站写入" });
    }
    next();
  });
  app.use(express.json({ limit: "48mb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, name: "CodeFlowGraph" }),
  );
  app.get("/api/gallery", async (_req, res) => res.json(await store.list()));
  app.post("/api/images", async (req, res) =>
    res.status(201).json(await store.create(req.body)),
  );
  app.post("/api/gallery/open", async (req, res) =>
    res.json(await store.open(req.body?.id)),
  );
  app.get("/api/images/:id", async (req, res) =>
    res.json(await store.read(req.params.id)),
  );
  app.patch("/api/images/:id", async (req, res) =>
    res.json(await store.save(req.params.id, req.body)),
  );
  app.delete("/api/images/:id", async (req, res) =>
    res.json(await store.remove(req.params.id, req.body)),
  );
  app.use(["/api/content", "/api/state"], (_req, res) =>
    res
      .status(410)
      .json({ error: "页面版本已更新，请刷新浏览器后使用图片列表" }),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  const dist = path.join(here, "..", "dist");
  app.use(express.static(dist, { index: false }));
  app.get(["/", "/admin", "/admin/"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(dist, "index.html"));
  });
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    res.status(status).json({
      error:
        status === 413
          ? "文件超过大小限制"
          : status >= 500
            ? "无法读取或保存服务器内容，请重试"
            : error.message,
    });
  });
  return app;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST || "127.0.0.1",
    port = Number(process.env.PORT || 3046);
  createApp().listen(port, host, () =>
    console.log(`CodeFlowGraph: http://${host}:${port}`),
  );
}
