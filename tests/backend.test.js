import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../backend/server.js";
import { createStore } from "../backend/store.js";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 500 400 1200"><text x="10" y="530">Network</text></svg>';
const label = {
  id: "label_1",
  text: "注意力模块\nQKV",
  x: -40.25,
  y: 680.75,
  fontSize: 18,
};
test("SVG-coordinate labels persist; partial saves, validation, conflicts and SVG replacement", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-label-api-"));
  const server = createApp(dir).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const patch = (body) =>
    fetch(`${base}/api/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const original = await (await fetch(`${base}/api/content`)).json();
    assert.equal(original.schemaVersion, 3);
    assert.equal(original.svg, null);
    assert.deepEqual(original.labels, []);
    assert.ok(!("code" in original));
    assert.equal((await patch({ revision: 1, labels: [label] })).status, 400);
    const saved = await (
      await patch({
        revision: original.revision,
        svg: { name: "graph.svg", content: svg },
        labels: [label],
      })
    ).json();
    assert.equal(saved.revision, 2);
    const moved = { ...label, x: 90.5, y: 980.125 };
    assert.equal((await patch({ revision: 2, labels: [moved] })).status, 200);
    const reloaded = await createStore(dir).read();
    assert.deepEqual(reloaded.labels, [moved]);
    assert.equal(reloaded.svg.content, svg);
    assert.equal((await readdir(path.join(dir, "svg"))).length, 1);
    assert.equal((await patch({ revision: 2, labels: [] })).status, 409);
    for (const invalid of [
      [{ ...label, x: null }],
      [{ ...label, fontSize: -1 }],
      [{ ...label, text: " " }],
      [label, label],
    ])
      assert.equal((await patch({ revision: 3, labels: invalid })).status, 400);
    assert.equal(
      (
        await patch({
          revision: 3,
          code: { name: "old.py", content: "removed" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await patch({
          revision: 3,
          svg: { name: "bad.svg", content: "not svg" },
        })
      ).status,
      400,
    );
    // Renaming the identical drawing preserves coordinates; different content clears them.
    assert.equal(
      (await patch({ revision: 3, svg: { name: "renamed.svg", content: svg } }))
        .status,
      200,
    );
    assert.deepEqual((await createStore(dir).read()).labels, [moved]);
    assert.equal(
      (
        await patch({
          revision: 4,
          svg: { name: "new.svg", content: svg.replace("Network", "Other") },
        })
      ).status,
      200,
    );
    assert.deepEqual((await createStore(dir).read()).labels, []);
    assert.equal((await readdir(path.join(dir, "svg"))).length, 2);
    assert.equal((await fetch(`${base}/api/projects`)).status, 404);
    assert.equal((await fetch(`${base}/admin`)).status, 200);
    assert.equal((await fetch(`${base}/admin/`)).status, 200);
    assert.deepEqual(
      Object.keys(await (await fetch(`${base}/api/state`)).json()).sort(),
      ["revision", "updatedAt"],
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("version 2 migration preserves SVG and keeps an exact backup of removed code", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-v2-"));
  try {
    const hash = createHash("sha256").update(svg).digest("hex");
    await mkdir(path.join(dir, "svg"));
    await writeFile(path.join(dir, "svg", `${hash}.svg`), svg);
    const old = JSON.stringify(
      {
        schemaVersion: 2,
        revision: 12,
        code: { name: "attention.py", content: "important old code" },
        svg: { name: "old.svg", hash },
        updatedAt: "2026-09-20T00:00:00Z",
      },
      null,
      2,
    );
    await writeFile(path.join(dir, "content.json"), old);
    const store = createStore(dir),
      content = await store.read();
    assert.equal(content.schemaVersion, 3);
    assert.equal(content.revision, 13);
    assert.equal(content.svg.content, svg);
    assert.deepEqual(content.labels, []);
    assert.ok(!("code" in content));
    assert.equal(
      await readFile(path.join(dir, "content-v2.backup.json"), "utf8"),
      old,
    );
    await store.save({ revision: 13, labels: [label] });
    assert.deepEqual((await createStore(dir).read()).labels, [label]);
    assert.equal(
      await readFile(path.join(dir, "content-v2.backup.json"), "utf8"),
      old,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("original project migration carries forward SVG without changing old sources or bindings", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-legacy-"));
  try {
    const snapshot = path.join(
      dir,
      "projects",
      "old-project",
      "versions",
      "1-version",
    );
    await mkdir(path.join(snapshot, "sources"), { recursive: true });
    await mkdir(path.join(dir, "projects", "unfinished-project"));
    await writeFile(
      path.join(dir, "workspace.json"),
      JSON.stringify({ activeProjectId: "old-project" }),
    );
    await writeFile(
      path.join(dir, "projects", "old-project", "current.json"),
      JSON.stringify({ version: "1-version" }),
    );
    await writeFile(
      path.join(snapshot, "project.json"),
      JSON.stringify({ svg: { name: "original.svg" } }),
    );
    await writeFile(path.join(snapshot, "network.svg"), svg);
    await writeFile(path.join(snapshot, "sources", "model.py"), "old code");
    await writeFile(
      path.join(snapshot, "bindings.json"),
      '[{"old":"binding"}]',
    );
    const p = await createStore(dir).read();
    assert.equal(p.svg.content, svg);
    assert.deepEqual(p.labels, []);
    assert.equal(
      await readFile(path.join(snapshot, "sources", "model.py"), "utf8"),
      "old code",
    );
    assert.equal(
      await readFile(path.join(snapshot, "bindings.json"), "utf8"),
      '[{"old":"binding"}]',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
