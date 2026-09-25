import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { createApp } from "../backend/server.js";
import { demoProject } from "../backend/sample.js";
import { exportProject, importProject } from "../backend/archive.js";
import { validateProject } from "../backend/store.js";

test("snapshot persistence, conflict protection, ZIP round trip, restart and delete", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-api-"));
  let server = createApp(dir).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = "GET", data) =>
    fetch(`${base}/api${route}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  try {
    const create = await request("/projects", "POST", {
      name: "测试模型",
      template: "attention",
    });
    assert.equal(create.status, 201);
    const p = await create.json();
    assert.equal(p.bindings.length, 5);
    assert.equal(
      p.files[0].content.split("\n")[19].trim(),
      "qkv = self.qkv(x)",
    );
    const badOrigin = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: {
        Origin: "https://other.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "bad" }),
    });
    assert.equal(badOrigin.status, 403);
    p.ui.camera = { scale: 2.5, centerX: 800, centerY: 640 };
    p.ui.split = 32;
    p.bindings[0].note = "$Q=XW_Q$";
    const writes = await Promise.all([
      request(`/projects/${p.id}`, "PUT", p),
      request(`/projects/${p.id}`, "PUT", p),
    ]);
    assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
    const saved = await (await request(`/projects/${p.id}`)).json();
    assert.equal(saved.revision, 2);
    assert.equal(saved.ui.camera.scale, 2.5);
    assert.equal(saved.ui.split, 32);
    const pointer = JSON.parse(
      await readFile(path.join(dir, "projects", p.id, "current.json"), "utf8"),
    );
    const bindings = JSON.parse(
      await readFile(
        path.join(
          dir,
          "projects",
          p.id,
          "versions",
          pointer.version,
          "bindings.json",
        ),
        "utf8",
      ),
    );
    assert.equal(bindings[0].note, "$Q=XW_Q$");
    const zip = await (await request(`/projects/${p.id}/export`)).arrayBuffer();
    const archive = await JSZip.loadAsync(zip);
    assert.ok(archive.file("attention.py"));
    assert.ok(archive.file("attention.svg"));
    assert.ok(archive.file("bindings.json"));
    const imported = await fetch(`${base}/api/projects/import`, {
      method: "POST",
      headers: { "Content-Type": "application/zip" },
      body: Buffer.from(zip),
    });
    assert.equal(imported.status, 201);
    const p2 = await imported.json();
    assert.notEqual(p2.id, p.id);
    assert.deepEqual(p2.bindings, saved.bindings);
    assert.deepEqual(p2.ui, saved.ui);
    await new Promise((resolve) => server.close(resolve));
    server = createApp(dir).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const afterRestart = await (await request(`/projects/${p.id}`)).json();
    assert.deepEqual(afterRestart, saved);
    const oldFile = path.join(
      dir,
      "projects",
      p.id,
      "versions",
      pointer.version,
      "network.svg",
    );
    const oldInode = (await stat(oldFile)).ino;
    const patch = await request(`/projects/${p.id}`, "PATCH", {
      revision: saved.revision,
      ui: { ...saved.ui, split: 60 },
    });
    assert.equal(patch.status, 200);
    const latest = JSON.parse(
      await readFile(path.join(dir, "projects", p.id, "current.json"), "utf8"),
    );
    const newFile = path.join(
      dir,
      "projects",
      p.id,
      "versions",
      latest.version,
      "network.svg",
    );
    assert.equal(
      (await stat(newFile)).ino,
      oldInode,
      "layout saves reuse unchanged SVG bytes",
    );
    const patched = await (await request(`/projects/${p.id}`)).json();
    assert.equal(patched.ui.split, 60);
    assert.equal(patched.svg.content, saved.svg.content);
    assert.equal((await request(`/projects/${p.id}`, "DELETE")).status, 200);
    assert.equal((await request(`/projects/${p.id}`)).status, 404);
    const bootstrap = await (await request("/bootstrap")).json();
    assert.equal(bootstrap.projects.length, 1);
    assert.equal(bootstrap.activeProjectId, p2.id);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
test("reject invalid bindings, paths, duplicate files and malformed archives", async () => {
  let p = demoProject();
  p.files[0].name = "../../bad.py";
  assert.throws(() => validateProject(p));
  p = demoProject();
  p.bindings[0].svgRegion.x = Infinity;
  assert.throws(() => validateProject(p));
  p = demoProject();
  p.bindings[0].code.endLine = 10000;
  assert.throws(() => validateProject(p));
  p = demoProject();
  p.files.push({ ...p.files[0], id: "other", name: "Attention.py" });
  assert.throws(() => validateProject(p));
  await assert.rejects(() => importProject(Buffer.from("not a ZIP")));
  const zip = new JSZip();
  zip.file("../escape.py", "bad");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => importProject(buffer));
});
test("portable archive preserves multiple files, nonzero coordinates, comments and layout", async () => {
  const p = demoProject("portable");
  p.files.push({
    id: "blocks",
    name: "blocks.py",
    content: "class Block:\n    pass\n",
  });
  p.bindings[0].svgRegion = {
    x: -120.25,
    y: 9001.5,
    width: 215.5,
    height: 199,
  };
  p.bindings[0].annotation = { x: -550, y: 9001 };
  p.ui.showCode = true;
  p.ui.theme = "light";
  const normalized = validateProject(p);
  const imported = await importProject(await exportProject(normalized));
  assert.deepEqual(imported, normalized);
});
