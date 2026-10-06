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

test("image locks survive restart and reject all label writes until explicitly unlocked", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-image-lock-"));
  try {
    const initial = createStore(dir);
    const folderId = (await initial.createFolder({ name: "测试目录" })).gallery
      .activeFolderId;
    const { image: a } = await initial.create({
      folderId,
      svg: { name: "a.svg", content: svg },
      labels: [label],
    });
    const { image: b } = await initial.create({
      folderId,
      svg: { name: "b.svg", content: svg },
    });
    assert.equal(a.locked, false);
    assert.equal(b.locked, false);
    // Galleries saved by older versions have no lock field.
    const file = path.join(dir, "gallery.json");
    const legacy = JSON.parse(await readFile(file, "utf8"));
    legacy.images.forEach((image) => {
      delete image.locked;
    });
    await writeFile(file, JSON.stringify(legacy));
    const store = createStore(dir);
    assert.equal((await store.read(a.id)).locked, false);
    for (const locked of [null, 0, "true"])
      await assert.rejects(store.save(a.id, { revision: 1, locked }), {
        status: 400,
      });
    const result = await store.save(a.id, { revision: 1, locked: true });
    assert.equal(result.image.locked, true);
    assert.equal(
      result.gallery.images.find((image) => image.id === a.id).locked,
      true,
    );
    const restarted = createStore(dir);
    assert.equal((await restarted.read(a.id)).locked, true);
    assert.equal((await restarted.read(b.id)).locked, false);
    for (const patch of [
      { labels: [] },
      { labels: [{ ...label, text: "误改", x: 100 }] },
      { labels: [label, { ...label, id: "extra" }] },
      { locked: false, labels: [] },
    ])
      await assert.rejects(restarted.save(a.id, { revision: 2, ...patch }), {
        status: 409,
        message: /已锁定/,
      });
    await assert.rejects(restarted.save(a.id, { revision: 1, labels: [] }), {
      status: 409,
    });
    assert.deepEqual((await restarted.read(a.id)).labels, [label]);
    assert.equal((await restarted.read(a.id)).revision, 2);
    await restarted.save(b.id, { revision: 1, labels: [label] });
    await restarted.save(a.id, { revision: 2, locked: false });
    const edited = { ...label, text: "解锁后修改", x: 25 };
    await restarted.save(a.id, { revision: 3, labels: [edited] });
    const final = await createStore(dir).read(a.id);
    assert.equal(final.locked, false);
    assert.deepEqual(final.labels, [edited]);
    assert.deepEqual((await createStore(dir).read(b.id)).labels, [label]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gallery API persists independently named images and labels, remembers selection and deletes shared SVG safely", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-gallery-api-"));
  const server = createApp(dir).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, method = "GET", data) =>
    fetch(`${base}/api${route}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  try {
    const initial = await (await request("/gallery")).json();
    assert.deepEqual(initial.images, []);
    assert.equal(initial.activeImageId, null);
    const folderId = (
      await (await request("/folders", "POST", { name: "模型" })).json()
    ).gallery.activeFolderId;
    const aResponse = await request("/images", "POST", {
      folderId,
      name: "UNet",
      svg: { name: "model.svg", content: svg },
      labels: [label],
    });
    assert.equal(aResponse.status, 201);
    const a = (await aResponse.json()).image;
    const b = (
      await (
        await request("/images", "POST", {
          name: "UNet++",
          folderId,
          svg: { name: "same.svg", content: svg },
        })
      ).json()
    ).image;
    assert.notEqual(a.id, b.id);
    assert.equal((await readdir(path.join(dir, "gallery-svg"))).length, 1);
    const moved = { ...label, x: 81.125, y: 1100.5 };
    // Independent image versions let separate pages save different images without conflict.
    const changes = await Promise.all([
      request(`/images/${a.id}`, "PATCH", {
        revision: 1,
        labels: [moved],
        name: "水体 UNet",
      }),
      request(`/images/${b.id}`, "PATCH", {
        revision: 1,
        labels: [{ ...label, text: "另一张图的标签" }],
      }),
    ]);
    assert.deepEqual(
      changes.map((r) => r.status),
      [200, 200],
    );
    assert.equal(
      (await request(`/images/${a.id}`, "PATCH", { revision: 1, labels: [] }))
        .status,
      409,
    );
    assert.equal(
      (await request(`/images/${a.id}`, "DELETE", { revision: 1 })).status,
      409,
    );
    for (const patch of [
      { labels: [label, label] },
      { labels: [{ ...label, x: null }] },
      { name: " " },
      { code: "removed" },
    ])
      assert.equal(
        (await request(`/images/${a.id}`, "PATCH", { revision: 2, ...patch }))
          .status,
        400,
      );
    assert.equal(
      (
        await request("/images", "POST", {
          svg: { name: "bad.svg", content: "not svg" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("/gallery/open", "POST", { id: "missing" })).status,
      404,
    );
    await request("/gallery/open", "POST", { id: a.id });
    const reopened = createStore(dir),
      list = await reopened.list();
    assert.equal(list.activeImageId, a.id);
    assert.equal(list.images.length, 2);
    assert.equal(list.images.find((i) => i.id === a.id).name, "水体 UNet");
    assert.ok(!("labels" in list.images[0]) && !("svg" in list.images[0]));
    assert.deepEqual((await reopened.read(a.id)).labels, [moved]);
    assert.equal((await reopened.read(b.id)).labels[0].text, "另一张图的标签");
    assert.equal((await reopened.read(a.id)).svg.content, svg);
    assert.equal(
      (await request(`/images/${a.id}`, "DELETE", { revision: 2 })).status,
      200,
    );
    assert.equal((await request(`/images/${a.id}`)).status, 404);
    assert.equal((await createStore(dir).list()).activeImageId, b.id);
    assert.equal((await readdir(path.join(dir, "gallery-svg"))).length, 1);
    assert.equal(
      (await request(`/images/${b.id}`, "DELETE", { revision: 2 })).status,
      200,
    );
    assert.deepEqual((await createStore(dir).list()).images, []);
    assert.equal((await createStore(dir).list()).activeImageId, null);
    assert.deepEqual(await readdir(path.join(dir, "gallery-svg")), []);
    assert.equal((await request("/content")).status, 410);
    assert.equal((await fetch(`${base}/admin`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

for (const version of [2, 3])
  test(`version ${version} migration keeps the old SVG and labels, retains backups and never resurrects deleted images`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), `cfg-v${version}-`));
    try {
      const hash = createHash("sha256").update(svg).digest("hex");
      await mkdir(path.join(dir, "svg"));
      await writeFile(path.join(dir, "svg", `${hash}.svg`), svg);
      const old = JSON.stringify(
        {
          schemaVersion: version,
          revision: 12,
          ...(version === 2
            ? { code: { name: "attention.py", content: "important old code" } }
            : { labels: [label] }),
          svg: { name: "原有网络.svg", hash },
          updatedAt: "2026-09-20T00:00:00Z",
        },
        null,
        2,
      );
      await writeFile(path.join(dir, "content.json"), old);
      const store = createStore(dir),
        gallery = await store.list();
      assert.equal(gallery.schemaVersion, 5);
      assert.equal(gallery.images.length, 1);
      const image = await store.read(gallery.activeImageId);
      assert.equal(image.name, "原有网络");
      assert.equal(image.svg.content, svg);
      assert.deepEqual(image.labels, version === 3 ? [label] : []);
      await store.save(image.id, { revision: 1, name: "重新命名" });
      assert.equal((await createStore(dir).list()).images[0].name, "重新命名");
      await store.remove(image.id, { revision: 2 });
      assert.deepEqual((await createStore(dir).list()).images, []);
      assert.equal(await readFile(path.join(dir, "content.json"), "utf8"), old);
      assert.equal(
        await readFile(path.join(dir, "svg", `${hash}.svg`), "utf8"),
        svg,
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
    const store = createStore(dir),
      gallery = await store.list(),
      image = await store.read(gallery.activeImageId);
    assert.equal(image.svg.content, svg);
    assert.deepEqual(image.labels, []);
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

test("folders require membership, persist descriptions and safely delete only their own images", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-folders-"));
  try {
    const store = createStore(dir);
    assert.deepEqual((await store.list()).folders, []);
    await assert.rejects(
      store.create({ svg: { name: "x.svg", content: svg } }),
      { status: 400 },
    );
    await assert.rejects(store.createFolder({ name: " " }), { status: 400 });
    await assert.rejects(
      store.createFolder({ name: "bad", description: "x".repeat(201) }),
      { status: 400 },
    );
    let result = await store.createFolder({
      name: "CNN",
      description: "卷积网络",
    });
    const aFolder = result.gallery.folders[0];
    const { image: a } = await store.create({
      folderId: aFolder.id,
      svg: { name: "a.svg", content: svg },
      labels: [label],
    });
    await assert.rejects(
      store.removeFolder(aFolder.id, { revision: aFolder.revision }),
      { status: 409 },
    );
    result = await store.createFolder({ name: "Transformer" });
    const bFolder = result.gallery.folders.find(
      (folder) => folder.name === "Transformer",
    );
    assert.equal(result.image, null);
    assert.equal(result.gallery.activeImageId, null);
    await store.saveFolder(bFolder.id, {
      revision: bFolder.revision,
      name: "Attention",
      description: "注意力结构\nQKV 投影",
    });
    const { image: b } = await store.create({
      folderId: aFolder.id,
      svg: { name: "b.svg", content: svg },
      labels: [label],
    });
    await store.save(b.id, { revision: 1, locked: true });
    await store.save(b.id, { revision: 2, folderId: bFolder.id });
    const moved = await store.read(b.id);
    assert.equal(moved.folderId, bFolder.id);
    assert.equal(moved.locked, true);
    assert.deepEqual(moved.labels, [label]);
    assert.equal((await store.list()).activeFolderId, bFolder.id);
    await assert.rejects(
      store.create({
        folderId: "missing",
        svg: { name: "x.svg", content: svg },
      }),
      { status: 404 },
    );
    await assert.rejects(
      store.save(a.id, { revision: 1, folderId: "missing" }),
      { status: 404 },
    );
    const selected = await store.openFolder(aFolder.id);
    assert.equal(selected.image.id, a.id);
    const currentA = selected.gallery.folders.find(
      (folder) => folder.id === aFolder.id,
    );
    await store.removeFolder(aFolder.id, { revision: currentA.revision });
    assert.equal((await store.list()).activeFolderId, bFolder.id);
    assert.equal((await store.list()).activeImageId, b.id);
    await assert.rejects(store.read(a.id), { status: 404 });
    // Both images used the same physical SVG; the surviving folder retains it.
    assert.equal((await store.read(b.id)).svg.content, svg);
    assert.equal((await readdir(path.join(dir, "gallery-svg"))).length, 1);
    const restarted = createStore(dir);
    const restored = await restarted.list();
    assert.equal(restored.folders[0].description, "注意力结构\nQKV 投影");
    assert.equal(restored.activeFolderId, bFolder.id);
    await restarted.remove(b.id, { revision: 3 });
    assert.equal((await restarted.list()).activeImageId, null);
    assert.equal((await restarted.list()).activeFolderId, bFolder.id);
    const empty = (await restarted.list()).folders[0];
    await restarted.removeFolder(empty.id, { revision: empty.revision });
    assert.deepEqual((await createStore(dir).list()).folders, []);
    assert.equal((await createStore(dir).list()).activeFolderId, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("version 4 galleries migrate once into a default folder without losing IDs, labels or locks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-v4-folders-"));
  try {
    const initial = createStore(dir);
    const folderId = (await initial.createFolder({ name: "fixture" })).gallery
      .activeFolderId;
    const { image } = await initial.create({
      folderId,
      name: "原有网络",
      svg: { name: "original.svg", content: svg },
      labels: [label],
    });
    await initial.save(image.id, { revision: 1, locked: true });
    const file = path.join(dir, "gallery.json");
    const old = JSON.parse(await readFile(file, "utf8"));
    old.schemaVersion = 4;
    delete old.folders;
    delete old.activeFolderId;
    old.images.forEach((item) => {
      delete item.folderId;
    });
    const backup = JSON.stringify(old, null, 2);
    await writeFile(file, backup);
    const migrated = createStore(dir),
      gallery = await migrated.list();
    assert.equal(gallery.schemaVersion, 5);
    assert.equal(gallery.folders[0].name, "默认目录");
    assert.equal(gallery.activeImageId, image.id);
    assert.equal(gallery.activeFolderId, gallery.folders[0].id);
    const restored = await migrated.read(image.id);
    assert.equal(restored.name, image.name);
    assert.equal(restored.locked, true);
    assert.equal(restored.revision, 2);
    assert.equal(restored.svg.content, svg);
    assert.deepEqual(restored.labels, [label]);
    assert.equal(
      await readFile(path.join(dir, "gallery.v4.backup.json"), "utf8"),
      backup,
    );
    await migrated.removeFolder(gallery.folders[0].id, {
      revision: gallery.folders[0].revision,
    });
    assert.deepEqual((await createStore(dir).list()).folders, []);
    assert.deepEqual((await createStore(dir).list()).images, []);
    assert.equal(
      await readFile(path.join(dir, "gallery.v4.backup.json"), "utf8"),
      backup,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
