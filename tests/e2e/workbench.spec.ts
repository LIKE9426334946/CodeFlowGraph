import { test, expect, type Page } from "@playwright/test";

async function seed(page: Page, name: string) {
  const response = await page.request.post("/api/projects", {
    data: { name, template: "attention" },
  });
  expect(response.status()).toBe(201);
  const project = await response.json();
  await page.goto("/");
  await expect(page.locator("#cfg-scene")).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  return project;
}
async function scenePoint(page: Page, x: number, y: number) {
  return page.locator("#cfg-scene").evaluate(
    (element, p) => {
      const point = new DOMPoint(p.x, p.y).matrixTransform(
        (element as SVGSVGElement).getScreenCTM()!,
      );
      return { x: point.x, y: point.y };
    },
    { x, y },
  );
}
async function draw(
  page: Page,
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

test("select multiple code lines, bind SVG coordinates, edit lines and restore from server", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const project = await seed(page, "Coordinate QA");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 19; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Shift");
  await expect(page.locator(".pane-footer")).toContainText("第 20–22 行");
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  await page
    .getByRole("button", { name: "绑定代码与 SVG", exact: true })
    .click();
  const a = await scenePoint(page, 226, 150),
    b = await scenePoint(page, 449, 226);
  await draw(page, a, b);
  await expect(page.getByLabel("绑定名称", { exact: true })).toBeVisible();
  await page.getByLabel("绑定名称", { exact: true }).fill("Test QKV");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  let saved = await (
    await page.request.get(`/api/projects/${project.id}`)
  ).json();
  await expect
    .poll(async () => {
      saved = await (
        await page.request.get(`/api/projects/${project.id}`)
      ).json();
      return saved.bindings.length;
    })
    .toBe(6);
  let added = saved.bindings.find((b: any) => b.name === "Test QKV");
  expect(added.code).toMatchObject({ startLine: 20, endLine: 22 });
  expect(added.svgRegion.x).toBeCloseTo(226, 0);
  expect(added.svgRegion.y).toBeCloseTo(150, 0);
  expect(added.svgRegion.width).toBeCloseTo(223, 0);
  await page.getByRole("button", { name: "关闭绑定详情" }).click();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page
    .getByRole("button", { name: "在 SVG 中显示代码", exact: true })
    .click();
  await expect(
    page
      .locator("#cfg-bindings text")
      .filter({ hasText: "attention.py · L20–22" }),
  ).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.insertText("# inserted line\n");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(async () => {
      saved = await (
        await page.request.get(`/api/projects/${project.id}`)
      ).json();
      return saved.files[0].content.startsWith("# inserted line");
    })
    .toBe(true);
  added = saved.bindings.find((b: any) => b.name === "Test QKV");
  expect(added.code).toMatchObject({ startLine: 21, endLine: 23 });
  expect(added.svgRegion.x).toBeCloseTo(226, 0);
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("# inserted line");
  await expect(
    page.getByRole("button", { name: "在 SVG 中显示代码" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("bidirectional navigation, notes with LaTeX, code and SVG search, ZIP export/import", async ({
  page,
}) => {
  const project = await seed(page, "Navigation QA");
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  const qkv = await scenePoint(page, 330, 185);
  await page.mouse.click(qkv.x, qkv.y);
  await expect(page.getByLabel("绑定名称", { exact: true })).toHaveValue(
    "QKV Projection",
  );
  await expect(page.locator(".pane-footer")).toContainText("第 20 行");
  await page.getByRole("button", { name: "预览公式", exact: true }).click();
  await expect(page.locator(".katex")).toBeVisible();
  await page.getByRole("button", { name: "编辑备注", exact: true }).click();
  await page
    .getByLabel("Markdown 备注")
    .fill("### Projection\n\n$$Q=XW_Q$$\n\nneedle-note");
  await page.getByRole("button", { name: "关闭绑定详情" }).click();
  await page.keyboard.press("Control+k");
  await page
    .getByPlaceholder("搜索代码、SVG 文字、绑定名称或备注…")
    .fill("needle-note");
  await expect(page.locator(".search-results")).toContainText("QKV Projection");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.keyboard.press("Control+k");
  await page
    .getByPlaceholder("搜索代码、SVG 文字、绑定名称或备注…")
    .fill("Linear");
  await expect(page.locator(".search-results")).toContainText("SVG 文字");
  await expect(page.locator(".search-results")).toContainText("nn.Linear");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  // A real gutter click must locate the corresponding SVG block.
  await page
    .locator('.cm-binding-gutter .binding-dot[title="QKV Projection"]')
    .click();
  await expect(page.locator(".selected-strip")).toContainText("QKV Projection");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const file = await download;
  const path = await file.path();
  expect(path).toBeTruthy();
  await page
    .locator('input[type=file][accept=".zip,application/zip"]')
    .setInputFiles(path!);
  await expect(page.getByRole("status")).toContainText("项目已导入");
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  expect(bootstrap.activeProjectId).not.toBe(project.id);
  const imported = await (
    await page.request.get(`/api/projects/${bootstrap.activeProjectId}`)
  ).json();
  expect(imported.bindings[0].note).toContain("needle-note");
});

test("nonzero SVG viewBox, transformed text search, safe markup and wheel anchor", async ({
  page,
}) => {
  await seed(page, "ViewBox QA");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-300 500 1000 2200"><script>window.BADSVG=1</script><style>.label{fill:#246}</style><rect x="-300" y="500" width="1000" height="2200" fill="white"/><g transform="translate(-100,800) scale(2)"><rect width="150" height="60" fill="#cde"/><text class="label" x="10" y="30">UniqueLayerNorm</text></g></svg>';
  await page
    .locator('input[type=file][accept=".svg,image/svg+xml"]')
    .setInputFiles({
      name: "nonzero.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(svg),
    });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator("#cfg-scene")).toHaveAttribute(
    "viewBox",
    "-300 500 1000 2200",
  );
  expect(await page.evaluate(() => (window as any).BADSVG)).toBeUndefined();
  await expect(page.locator("#cfg-scene script")).toHaveCount(0);
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  await page
    .getByRole("button", { name: "绑定代码与 SVG", exact: true })
    .click();
  await draw(
    page,
    await scenePoint(page, -100, 800),
    await scenePoint(page, 200, 920),
  );
  await expect(page.locator(".region-coordinates")).toContainText("X -100.0");
  await expect(page.locator(".region-coordinates")).toContainText("Y 800.0");
  await page.getByRole("button", { name: "关闭绑定详情" }).click();
  const point = await scenePoint(page, 50, 860);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -90);
  await expect
    .poll(async () =>
      Number((await page.locator(".zoom-value").innerText()).replace("%", "")),
    )
    .toBeGreaterThan(25);
  const after = await scenePoint(page, 50, 860);
  expect(Math.abs(after.x - point.x)).toBeLessThan(2);
  expect(Math.abs(after.y - point.y)).toBeLessThan(2);
  await page.keyboard.press("Control+k");
  await page
    .getByPlaceholder("搜索代码、SVG 文字、绑定名称或备注…")
    .fill("UniqueLayerNorm");
  await page.locator(".search-results button").click();
  await expect(page.locator("#cfg-preview rect")).toBeVisible();
});

test("tablet touch pan, pinch, region creation and portrait tabs", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3047");
  await seed(page, "Tablet QA");
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  const cdp = await context.newCDPSession(page);
  const box = await page.locator(".svg-viewport").boundingBox();
  const cx = box!.x + box!.width / 2,
    cy = box!.y + box!.height / 2;
  const scaleBefore = parseFloat(await page.locator(".zoom-value").innerText());
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cx - 50, y: cy, id: 0 },
      { x: cx + 50, y: cy, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: cx - 90, y: cy, id: 0 },
      { x: cx + 90, y: cy, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => parseFloat(await page.locator(".zoom-value").innerText()))
    .toBeGreaterThan(scaleBefore * 1.5);
  const before = await page
    .locator(".svg-viewport")
    .evaluate((e) => e.scrollTop);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: cx, y: cy, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: cx, y: cy - 90, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () =>
      page.locator(".svg-viewport").evaluate((e) => e.scrollTop),
    )
    .toBeGreaterThan(before + 50);
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  await page
    .getByRole("button", { name: "绑定代码与 SVG", exact: true })
    .click();
  const a = await scenePoint(page, 220, 145),
    b = await scenePoint(page, 460, 233);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...a, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...b, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByLabel("绑定名称", { exact: true })).toHaveValue(
    "绑定 6",
  );
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator(".portrait-tabs")).toBeVisible();
  await page
    .locator(".portrait-tabs")
    .getByRole("button", { name: "代码", exact: true })
    .click();
  await expect(page.locator(".code-pane")).toBeVisible();
  await expect(page.locator(".graph-pane")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("multiple files, rename, range changes, reselect and saved split/camera", async ({
  page,
}) => {
  const p = await seed(page, "Workspace state QA");
  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  await page.getByLabel("Python 文件名").fill("blocks.py");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  await page.locator(".cm-content").click();
  await page.keyboard.insertText(
    "import torch\n\ndef forward(x):\n    return x.relu()\n",
  );
  await page
    .getByRole("button", { name: "绑定代码与 SVG", exact: true })
    .click();
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  await draw(
    page,
    await scenePoint(page, 220, 145),
    await scenePoint(page, 460, 233),
  );
  await page.getByLabel("起始行", { exact: true }).fill("3");
  await page.getByLabel("结束行", { exact: true }).fill("4");
  await page.getByRole("button", { name: "颜色 #22bda3" }).click();
  await page.getByRole("button", { name: "重新框选", exact: true }).click();
  await page.getByRole("button", { name: "适应窗口", exact: true }).click();
  await draw(
    page,
    await scenePoint(page, 220, 617),
    await scenePoint(page, 460, 703),
  );
  await expect(page.locator(".region-coordinates")).toContainText("Y 617.0");
  await page.getByRole("button", { name: "关闭绑定详情" }).click();
  await page.getByRole("button", { name: "重命名文件", exact: true }).click();
  await page.getByLabel("Python 文件名").fill("relu.py");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  const split = page.getByRole("separator");
  await split.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  const saved = await (await page.request.get(`/api/projects/${p.id}`)).json();
  expect(saved.files.map((f: any) => f.name)).toContain("relu.py");
  expect(saved.bindings[5].code).toMatchObject({
    file: "relu.py",
    startLine: 3,
    endLine: 4,
  });
  expect(saved.bindings[5].color).toBe("#22bda3");
  expect(saved.ui.split).toBe(42);
  await page.reload();
  await expect(page.locator(".file-tabs .active")).toHaveText("pyrelu.py");
  await expect(page.getByRole("separator")).toHaveAttribute(
    "aria-valuenow",
    "42",
  );
  await expect
    .poll(async () =>
      Math.abs(
        parseFloat(await page.locator(".zoom-value").innerText()) -
          saved.ui.camera.scale * 100,
      ),
    )
    .toBeLessThan(1);
  await page.getByRole("button", { name: "删除文件", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator(".file-tabs>button")).toHaveCount(1);
  await expect(page.locator("#cfg-bindings>g")).toHaveCount(5);
});

test("large long SVG keeps its DOM while zooming, scrolls end to end and saves only UI deltas", async ({
  page,
}) => {
  const p = await seed(page, "Large SVG QA");
  const body = Array.from(
    { length: 4000 },
    (_, i) =>
      `<g transform="translate(30,${i * 65})"><rect width="440" height="45" fill="#eef"/><text x="12" y="28">Layer ${i}</text><path d="M220 45v20" stroke="#aaa"/></g>`,
  ).join("");
  await page
    .locator('input[type=file][accept=".svg,image/svg+xml"]')
    .setInputFiles({
      name: "large.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 260000">${body}</svg>`,
      ),
    });
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator("#cfg-scene svg>g")).toHaveCount(4000);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  const handle = await page.locator("#cfg-scene svg").elementHandle();
  const scale = parseFloat(await page.locator(".zoom-value").innerText());
  const requests: any[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH") requests.push(request.postDataJSON());
  });
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect
    .poll(async () => parseFloat(await page.locator(".zoom-value").innerText()))
    .toBeGreaterThan(scale);
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
  const viewport = page.locator(".svg-viewport");
  await viewport.focus();
  await page.keyboard.press("End");
  expect(await viewport.evaluate((e) => e.scrollTop)).toBeGreaterThan(250000);
  await page.keyboard.press("Home");
  expect(await viewport.evaluate((e) => e.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((body) => !("svg" in body) && !("files" in body))).toBe(
    true,
  );
  const saved = await (await page.request.get(`/api/projects/${p.id}`)).json();
  expect(saved.svg.content.length).toBeGreaterThan(600000);
});

test("a failed save retains changes and exports a local ZIP without overwriting server", async ({
  page,
}) => {
  await seed(page, "Save failure QA");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存");
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"模拟断线"}',
      });
    else await route.continue();
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.insertText("# local recovery\n");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("保存失败");
  await expect(page.locator(".cm-content")).toContainText("# local recovery");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出本地副本", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain("本地副本.zip");
  await page.unroute("**/api/projects/*");
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("已保存");
});
