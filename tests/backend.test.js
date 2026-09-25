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
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../backend/server.js";
import { createStore } from "../backend/store.js";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 1200"><text x="10" y="30">Network</text></svg>';
test("single content persists, partial code saves reuse SVG, stale writes rejected, old APIs removed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-simple-api-"));
  const server = createApp(dir).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const patch = async (body) =>
    fetch(`${base}/api/content`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const original = await (await fetch(`${base}/api/content`)).json();
    assert.equal(original.code.content, "");
    assert.equal(original.svg, null);
    const saved = await (
      await patch({
        revision: original.revision,
        code: {
          name: "attention.py",
          content: "import torch\nx = torch.randn(2, 3)\n",
        },
        svg: { name: "graph.svg", content: svg },
      })
    ).json();
    assert.equal(saved.revision, 2);
    const response = await patch({
      revision: saved.revision,
      code: { name: "attention.py", content: "# changed\n" },
    });
    assert.equal(response.status, 200);
    const store = createStore(dir);
    const reloaded = await store.read();
    assert.equal(reloaded.code.content, "# changed\n");
    assert.equal(reloaded.svg.content, svg);
    assert.equal((await readdir(path.join(dir, "svg"))).length, 1);
    assert.equal(
      (await patch({ revision: 2, code: { name: "old.py", content: "stale" } }))
        .status,
      409,
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
    assert.equal((await fetch(`${base}/api/projects`)).status, 404);
    assert.equal((await fetch(`${base}/admin`)).status, 200);
    assert.equal((await fetch(`${base}/admin/`)).status, 200);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.revision, 3);
    assert.ok(!Object.hasOwn(state, "svg"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("migration carries forward the active old code file and SVG without touching old projects", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-migration-"));
  try {
    const snapshot = path.join(
      dir,
      "projects",
      "my-project",
      "versions",
      "3-old-version",
    );
    await mkdir(path.join(dir, "projects", "unfinished-old-project"), {
      recursive: true,
    });
    await mkdir(path.join(snapshot, "sources"), { recursive: true });
    await writeFile(
      path.join(dir, "workspace.json"),
      JSON.stringify({ activeProjectId: "my-project" }),
    );
    await writeFile(
      path.join(dir, "projects", "my-project", "current.json"),
      JSON.stringify({ version: "3-old-version" }),
    );
    await writeFile(
      path.join(snapshot, "project.json"),
      JSON.stringify({
        files: [
          { id: "file-one", name: "model.py" },
          { id: "file-two", name: "attention.py" },
        ],
        svg: { name: "original.svg" },
        ui: { activeFileId: "file-two" },
      }),
    );
    await writeFile(
      path.join(snapshot, "sources", "file-one.py"),
      "first file",
    );
    await writeFile(
      path.join(snapshot, "sources", "file-two.py"),
      "selected code",
    );
    await writeFile(path.join(snapshot, "network.svg"), svg);
    await writeFile(
      path.join(snapshot, "bindings.json"),
      '[{"old":"binding"}]',
    );
    const p = await createStore(dir).read();
    assert.equal(p.code.name, "attention.py");
    assert.equal(p.code.content, "selected code");
    assert.equal(p.svg.content, svg);
    assert.equal(
      await readFile(path.join(snapshot, "bindings.json"), "utf8"),
      '[{"old":"binding"}]',
    );
    await writeFile(
      path.join(snapshot, "sources", "file-two.py"),
      "legacy change",
    );
    assert.equal(
      (await createStore(dir).read()).code.content,
      "selected code",
      "migration only happens once",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
