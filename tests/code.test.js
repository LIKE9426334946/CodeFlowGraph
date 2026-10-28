import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStore } from "../backend/store.js";

test("image code preserves whitespace across saving, restart and moves, and respects image locks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cfg-code-"));
  try {
    const initial = createStore(dir);
    const folderId = (await initial.createFolder({ name: "代码目录" })).gallery
      .activeFolderId;
    const svg = {
      name: "model.svg",
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>',
    };
    const labels = [
      { id: "label_1", text: "标签", x: 10, y: 20, fontSize: 12 },
    ];
    const { image: a } = await initial.create({ folderId, svg, labels });
    const { image: b } = await initial.create({ folderId, svg });
    assert.equal(a.code, "");
    assert.equal(b.code, "");
    const file = path.join(dir, "gallery.json");
    const legacy = JSON.parse(await readFile(file, "utf8"));
    legacy.images.forEach((image) => {
      delete image.code;
    });
    await writeFile(file, JSON.stringify(legacy));
    const store = createStore(dir);
    assert.equal((await store.read(a.id)).code, "");
    for (const code of [null, 1, {}, "x".repeat(200001)])
      await assert.rejects(store.save(a.id, { revision: 1, code }), {
        status: 400,
      });
    const code =
      "\r\nclass Model:\r\n\tdef forward(self, x):\r\n        x = self.layer(x)  \r\n\r\n\t\treturn x\r\n";
    const saved = await store.save(a.id, { revision: 1, code });
    assert.equal(Object.hasOwn(saved.image, "code"), false);
    assert.ok(
      saved.gallery.images.every((image) => !Object.hasOwn(image, "code")),
    );
    assert.equal(
      JSON.parse(await readFile(file, "utf8")).images.find(
        (image) => image.id === a.id,
      ).code,
      code,
    );
    const restarted = createStore(dir);
    const restored = await restarted.read(a.id);
    assert.equal(restored.code, code);
    assert.deepEqual(restored.svg, svg);
    assert.deepEqual(restored.labels, labels);
    assert.equal((await restarted.read(b.id)).code, "");
    await assert.rejects(restarted.save(a.id, { revision: 1, code: "stale" }), {
      status: 409,
    });
    const folder2 = (await restarted.createFolder({ name: "新目录" })).gallery
      .activeFolderId;
    const moved = await restarted.save(a.id, {
      revision: 2,
      folderId: folder2,
      name: "01-模型",
      reviewed: true,
    });
    const locked = await restarted.save(a.id, {
      revision: moved.image.revision,
      locked: true,
    });
    for (const patch of [
      { code: "" },
      { code: "changed" },
      { locked: false, code: "changed" },
    ])
      await assert.rejects(
        restarted.save(a.id, { revision: locked.image.revision, ...patch }),
        { status: 409, message: /已锁定/ },
      );
    assert.equal((await restarted.read(a.id)).code, code);
    assert.equal((await restarted.read(a.id)).reviewed, true);
    const unlocked = await restarted.save(a.id, {
      revision: locked.image.revision,
      locked: false,
    });
    const changedLabels = [{ ...labels[0], text: "修改后的标签" }];
    const changed = await restarted.save(a.id, {
      revision: unlocked.image.revision,
      labels: changedLabels,
    });
    assert.equal((await restarted.read(a.id)).code, code);
    await restarted.save(a.id, { revision: changed.image.revision, code: "" });
    const cleared = await createStore(dir).read(a.id);
    assert.equal(cleared.code, "");
    assert.deepEqual(cleared.labels, changedLabels);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
