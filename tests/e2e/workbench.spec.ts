import { test, expect, type Page } from "@playwright/test";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 500 600 2400"><style>text{fill:#506080;font-size:24px}rect{stroke:#aaa}</style><rect x="-100" y="500" width="600" height="2400" fill="white"/><g transform="translate(30 650)"><rect width="300" height="140" rx="6" fill="#e8e3fb"/><text x="22" y="80">Attention</text></g><text x="50" y="2820">Output</text></svg>';
async function seed(page: Page) {
  const gallery = await (await page.request.get("/api/gallery")).json();
  for (const image of gallery.images) {
    const removed = await page.request.delete(`/api/images/${image.id}`, {
      data: { revision: image.revision },
    });
    expect(removed.ok()).toBeTruthy();
  }
  const response = await page.request.post("/api/images", {
    data: { svg: { name: "model.svg", content: svg } },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).image;
}
async function saved(page: Page) {
  await expect(page.locator(".save-state")).toHaveText("已保存");
}
async function content(page: Page, id?: string) {
  const currentId =
    id || (await (await page.request.get("/api/gallery")).json()).activeImageId;
  return (await page.request.get(`/api/images/${currentId}`)).json();
}
async function horizontalEdges(page: Page) {
  const viewport = page.locator(".svg-viewport");
  const box = (await viewport.boundingBox())!;
  await viewport.evaluate((e) => {
    e.scrollLeft = 0;
  });
  const initial = (await page.locator("#display-svg").boundingBox())!;
  const width = await viewport.evaluate((e) => e.clientWidth);
  expect(
    Math.abs(initial.x - box.x - Math.max(0, (width - initial.width) / 2)),
  ).toBeLessThan(1);
  await viewport.evaluate((e) => {
    e.scrollLeft = e.scrollWidth;
  });
  if (initial.width > width) {
    const drawing = (await page.locator("#display-svg").boundingBox())!;
    expect(Math.abs(drawing.x + drawing.width - box.x - width)).toBeLessThan(
      1.5,
    );
  } else {
    expect(await viewport.evaluate((e) => e.scrollLeft)).toBe(0);
    expect(
      await viewport.evaluate((e) => e.scrollWidth - e.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  await viewport.evaluate((e) => {
    e.scrollLeft = 0;
  });
}
async function verticalEdges(page: Page) {
  const viewport = page.locator(".svg-viewport");
  const box = (await viewport.boundingBox())!;
  await viewport.evaluate((e) => {
    e.scrollTop = 0;
  });
  expect(
    Math.abs((await page.locator("#display-svg").boundingBox())!.y - box.y),
  ).toBeLessThan(1);
  await viewport.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  const drawing = (await page.locator("#display-svg").boundingBox())!;
  const height = await viewport.evaluate((e) => e.clientHeight);
  expect(Math.abs(drawing.y + drawing.height - box.y - height)).toBeLessThan(
    1.5,
  );
  await viewport.evaluate((e) => {
    e.scrollTop = 0;
  });
}
async function point(page: Page, x: number, y: number) {
  return page.locator("#label-overlay").evaluate(
    (e, p) => {
      const v = new DOMPoint(p.x, p.y).matrixTransform(
        (e as SVGSVGElement).getScreenCTM()!,
      );
      return { x: v.x, y: v.y };
    },
    { x, y },
  );
}
async function atMinimumHeight(page: Page) {
  await expect(page.getByRole("button", { name: "缩小图片" })).toBeDisabled();
  await expect
    .poll(async () => {
      const drawing = (await page.locator("#display-svg").boundingBox())!;
      const height = await page
        .locator(".svg-viewport")
        .evaluate((e) => e.clientHeight);
      return Math.abs(drawing.height - height);
    })
    .toBeLessThan(1);
  await horizontalEdges(page);
  await verticalEdges(page);
}
async function alignment(
  page: Page,
  label: { id: string; x: number; y: number },
) {
  const expected = await page.locator("#display-svg").evaluate((e, p) => {
    const v = new DOMPoint(p.x, p.y).matrixTransform(
      (e as SVGSVGElement).getScreenCTM()!,
    );
    return { x: v.x, y: v.y };
  }, label);
  const box = await page.locator(`[data-label-id="${label.id}"]`).boundingBox();
  expect(Math.abs(box!.x - expected.x)).toBeLessThan(1.5);
  expect(Math.abs(box!.y - expected.y)).toBeLessThan(1.5);
}
async function addLabel(page: Page, text: string, touch = false) {
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  const p = await point(page, 60, 610);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await page.getByRole("textbox", { name: "标签文字" }).fill(text);
  await page.getByRole("button", { name: "保存标签" }).click();
  await saved(page);
  return (await content(page)).labels.at(-1);
}

test("admin supports create/edit/drag/zoom/sync/delete labels without rebuilding the drawing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seed(page);
  await page.goto("/admin");
  await expect(page.locator(".cm-editor, .code-pane")).toHaveCount(0);
  await page.locator('input[type="file"]').setInputFiles({
    name: "network.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await expect(
    page.getByRole("button", { name: "打开图片：network", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await saved(page);
  await page.goto("/admin");
  await expect(page.locator("#display-svg")).toBeVisible();
  const sidebar = (await page
    .getByRole("complementary", { name: "图片工具栏" })
    .boundingBox())!;
  const canvas = (await page.locator(".svg-viewport").boundingBox())!;
  expect(sidebar.x).toBe(0);
  expect(sidebar.height).toBe(960);
  expect(canvas.x).toBe(sidebar.width);
  expect(canvas.width + sidebar.width).toBe(1440);
  expect(canvas.height).toBe(960);
  await horizontalEdges(page);
  expect(
    Math.abs(
      (await page.locator("#display-svg").boundingBox())!.width -
        (await page.locator(".svg-viewport").evaluate((e) => e.clientWidth)),
    ),
  ).toBeLessThan(1);
  await page.getByRole("button", { name: "放大图片" }).click();
  await horizontalEdges(page);
  await verticalEdges(page);
  // Zooming out must not retain the unscaled SVG box as blank scrolling space.
  await page.getByRole("button", { name: "恢复 100%" }).click();
  await page.getByRole("button", { name: "缩小图片" }).click();
  await horizontalEdges(page);
  await verticalEdges(page);
  await page.getByRole("button", { name: "适应宽度" }).click();
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /代码|分屏|上传/ }),
  ).toHaveCount(0);
  await page.locator("#display-svg").evaluate((e) => {
    (window as any).drawingBefore = e;
  });
  const label = await addLabel(page, "注意力模块\nQKV 投影");
  expect(label.x).toBeCloseTo(60, 1);
  expect(label.y).toBeCloseTo(610, 1);
  const labelElement = page.locator(`[data-label-id="${label.id}"]`);
  const actualFontSize = await labelElement
    .locator("text")
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(actualFontSize).toBeCloseTo(label.fontSize, 2); // Uploaded `text` rules are isolated.
  const box = (await labelElement.boundingBox())!;
  const scale = await page
    .locator("#label-overlay")
    .evaluate((e) => (e as SVGSVGElement).getScreenCTM()!.a);
  await page.mouse.move(box.x + 18, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(box.x + 138, box.y + 93, { steps: 8 });
  await page.mouse.up();
  await saved(page);
  const moved = (await content(page)).labels[0];
  expect(moved.x).toBeCloseTo(label.x + 120 / scale, 1);
  expect(moved.y).toBeCloseTo(label.y + 75 / scale, 1);
  await alignment(page, moved);
  const anchor = await point(page, moved.x + 20, moved.y + 10);
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => parseFloat(await page.locator(".zoom-label").innerText()))
    .toBeGreaterThan(scale * 100 * 1.3);
  const sameAnchor = await point(page, moved.x + 20, moved.y + 10);
  expect(Math.abs(sameAnchor.x - anchor.x)).toBeLessThan(2);
  expect(Math.abs(sameAnchor.y - anchor.y)).toBeLessThan(2);
  await alignment(page, moved);
  await page.mouse.move(1150, 530);
  await page.mouse.down();
  await page.mouse.move(1030, 430, { steps: 6 });
  await page.mouse.up();
  await alignment(page, moved);
  expect((await content(page)).labels[0]).toEqual(moved);
  expect(
    await page
      .locator("#display-svg")
      .evaluate((e) => e === (window as any).drawingBefore),
  ).toBe(true);
  await page.getByRole("button", { name: "适应宽度" }).click();
  const other = await page.context().newPage();
  await other.goto("/");
  await labelElement.click();
  await page.getByRole("textbox", { name: "标签文字" }).fill("已修改 <module>");
  await page.getByRole("button", { name: "保存标签" }).click();
  await saved(page);
  await expect(other.locator(`[data-label-id="${label.id}"]`)).toContainText(
    "已修改 <module>",
    { timeout: 12000 },
  );
  await page.reload();
  await expect(page.locator(`[data-label-id="${label.id}"]`)).toContainText(
    "已修改 <module>",
  );
  await page.locator(`[data-label-id="${label.id}"]`).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(page.locator("#display-svg")).toBeVisible();
  await expect(page.locator("[data-label-id]")).toHaveCount(0);
  // Adding a picture retains the previous image and its annotations.
  const retained = await addLabel(page, "旧图标签");
  const previous = await content(page);
  await page.goto("/admin");
  await page.locator('input[type="file"]').setInputFiles({
    name: "additional.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg.replace("Attention", "Additional")),
  });
  await expect(
    page.getByRole("button", { name: "打开图片：additional", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await saved(page);
  await expect(page.locator("[data-label-id]")).toHaveCount(0);
  expect((await content(page, previous.id)).labels[0].id).toBe(retained.id);
  expect(errors).toEqual([]);
  await other.close();
});

test("tablet taps place labels; touch drag, pinch and scrolling keep original SVG coordinates", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3047/admin");
  await seed(page);
  await page.reload();
  await expect(page.locator("#display-svg")).toBeVisible();
  const label = await addLabel(page, "平板标签", true);
  const cdp = await context.newCDPSession(page);
  const box = (await page
    .locator(`[data-label-id="${label.id}"]`)
    .boundingBox())!;
  const scale = await page
    .locator("#label-overlay")
    .evaluate((e) => (e as SVGSVGElement).getScreenCTM()!.a);
  const touch = (type: string, touchPoints: any[]) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  await touch("touchStart", [{ x: box.x + 12, y: box.y + 14, id: 0 }]);
  await touch("touchMove", [{ x: box.x + 92, y: box.y + 74, id: 0 }]);
  await touch("touchEnd", []);
  await saved(page);
  const moved = (await content(page)).labels[0];
  expect(moved.x).toBeCloseTo(label.x + 80 / scale, 1);
  expect(moved.y).toBeCloseTo(label.y + 60 / scale, 1);
  const target = (await page
    .locator(`[data-label-id="${label.id}"]`)
    .boundingBox())!;
  const cx = target.x + 12,
    cy = target.y + 14;
  const zoom = parseFloat(await page.locator(".zoom-label").innerText());
  await touch("touchStart", [
    { x: cx, y: cy, id: 0 },
    { x: cx + 100, y: cy, id: 1 },
  ]);
  await touch("touchMove", [
    { x: cx - 45, y: cy, id: 0 },
    { x: cx + 145, y: cy, id: 1 },
  ]);
  await touch("touchEnd", []);
  await expect
    .poll(async () => parseFloat(await page.locator(".zoom-label").innerText()))
    .toBeGreaterThan(zoom * 1.5);
  await expect(page.locator(".label-editor")).toHaveCount(0);
  expect((await content(page)).labels[0]).toEqual(moved);
  await alignment(page, moved);
  const viewport = page.locator(".svg-viewport"),
    top = await viewport.evaluate((e) => e.scrollTop);
  await page.mouse.move(1000, 600);
  await page.mouse.wheel(0, 1400);
  await expect
    .poll(async () => viewport.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(top + 1000);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole("button", { name: "适应宽度" }).click();
  await alignment(page, moved);
  await horizontalEdges(page);
  await verticalEdges(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(`[data-label-id="${label.id}"]`)).toContainText(
    "平板标签",
  );
  expect((await content(page)).labels[0]).toEqual(moved);
  // Pinching inward cannot shrink a long network below the viewport height.
  await touch("touchStart", [
    { x: 400, y: 500, id: 0 },
    { x: 700, y: 500, id: 1 },
  ]);
  await touch("touchMove", [
    { x: 545, y: 500, id: 0 },
    { x: 555, y: 500, id: 1 },
  ]);
  await touch("touchEnd", []);
  await atMinimumHeight(page);
  await alignment(page, moved);
  // The same labels are static when browsing on a touch device.
  await page.goto("http://127.0.0.1:3047/");
  const staticLabel = page.locator(`[data-label-id="${label.id}"]`);
  await expect(staticLabel).toBeVisible();
  await expect(
    page.getByRole("button", { name: "添加标签", exact: true }),
  ).toHaveCount(0);
  const beforeBrowse = await content(page);
  const staticBox = (await staticLabel.boundingBox())!;
  await page.touchscreen.tap(staticBox.x + 12, staticBox.y + 14);
  await expect(page.locator(".label-editor")).toHaveCount(0);
  await touch("touchStart", [
    { x: staticBox.x + 12, y: staticBox.y + 14, id: 0 },
  ]);
  await touch("touchMove", [
    { x: staticBox.x + 12, y: staticBox.y - 86, id: 0 },
  ]);
  await touch("touchEnd", []);
  await expect
    .poll(() => page.locator(".svg-viewport").evaluate((e) => e.scrollTop))
    .toBeGreaterThan(80);
  await alignment(page, moved);
  expect(await content(page)).toEqual(beforeBrowse);
  await context.close();
});

test("short SVG stays centered with aligned labels when the sidebar is hidden on smaller screens", async ({
  page,
}) => {
  await seed(page);
  await page.request.post("/api/images", {
    data: {
      svg: {
        name: "short.svg",
        content:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 500 600 200"><rect x="-100" y="500" width="600" height="200" fill="#e8edf9"/></svg>',
      },
    },
  });
  await page.goto("/admin");
  await expect(page.locator("#display-svg")).toBeVisible();
  const label = await addLabel(page, "居中标签");
  await page.locator("#display-svg").evaluate((e) => {
    (window as any).drawingBefore = e;
  });
  for (const size of [
    { width: 1440, height: 960 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await page.getByRole("button", { name: "适应宽度" }).click();
    await horizontalEdges(page);
    // A wide image stops at its full width, keeping the entire image visible.
    await expect(page.getByRole("button", { name: "缩小图片" })).toBeDisabled();
    await alignment(page, label);
    await page.getByRole("button", { name: "隐藏侧边栏" }).click();
    await expect(page.locator(".viewer-tools")).toBeHidden();
    const toggle = page.getByRole("button", { name: "展开侧边栏" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const toggleBox = (await toggle.boundingBox())!;
    expect(toggleBox.x).toBeLessThan(16);
    expect(toggleBox.y).toBeLessThan(16);
    expect(toggleBox.width).toBe(32);
    await expect
      .poll(
        async () => (await page.locator(".svg-viewport").boundingBox())!.width,
      )
      .toBe(size.width);
    await horizontalEdges(page);
    await alignment(page, label);
    await expect
      .poll(
        async () => (await page.locator("#display-svg").boundingBox())!.width,
      )
      .toBeCloseTo(size.width, 1);
    await toggle.click();
    await expect(page.locator(".viewer-tools")).toBeVisible();
    await horizontalEdges(page);
    await alignment(page, label);
    expect(
      await page
        .locator("#display-svg")
        .evaluate((e) => e === (window as any).drawingBefore),
    ).toBe(true);
    const viewport = page.locator(".svg-viewport");
    const box = (await viewport.boundingBox())!;
    expect(
      Math.abs((await page.locator("#display-svg").boundingBox())!.y - box.y),
    ).toBeLessThan(1);
    await viewport.evaluate((e) => {
      e.scrollTop = 10000;
    });
    expect(await viewport.evaluate((e) => e.scrollTop)).toBe(0);
    const sidebar = page.getByRole("complementary", { name: "图片工具栏" });
    await expect(
      sidebar.getByRole("button", { name: "添加标签", exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("button", { name: "添加 SVG" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("zoom buttons and wheel stop when the network bottom reaches the viewport bottom", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/admin");
  const label = await addLabel(page, "最小缩放标签");
  await page.goto("/");
  await expect(page.locator("#display-svg")).toBeVisible();
  const smaller = page.getByRole("button", { name: "缩小图片" });
  for (let i = 0; i < 30 && (await smaller.isEnabled()); i++)
    await smaller.click();
  await atMinimumHeight(page);
  await alignment(page, label);
  const scale = await page
    .locator("#display-svg")
    .evaluate((e) => (e as SVGSVGElement).getScreenCTM()!.a);
  await page.mouse.move(850, 550);
  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 200);
  await page.keyboard.up("Control");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await atMinimumHeight(page);
  expect(
    await page
      .locator("#display-svg")
      .evaluate((e) => (e as SVGSVGElement).getScreenCTM()!.a),
  ).toBeCloseTo(scale, 5);
  await page.getByRole("button", { name: "隐藏侧边栏" }).click();
  await horizontalEdges(page);
  await alignment(page, label);
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await page.setViewportSize({ width: 1440, height: 1180 });
  await atMinimumHeight(page);
  await alignment(page, label);
  await page.getByRole("button", { name: "放大图片" }).click();
  await expect(smaller).toBeEnabled();
  await alignment(page, label);
  expect((await content(page)).labels[0]).toEqual(label);
});

test("display labels cannot be edited with mouse or keyboard and dragging them only pans the drawing", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/admin");
  const label = await addLabel(page, "浏览标签");
  const beforeBrowse = await content(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/images/") && request.method() !== "GET")
      writes.push(request.method());
  });
  await page.goto("/");
  const annotation = page.locator(`[data-label-id="${label.id}"]`);
  await expect(annotation).toBeVisible();
  await expect(annotation).toHaveAttribute("role", "img");
  await expect(page.locator("#label-overlay [tabindex]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /添加标签|保存标签/ }),
  ).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const box = (await annotation.boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + 14);
  await page.mouse.dblclick(box.x + 12, box.y + 14);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Delete");
  await expect(page.locator(".label-editor, .placement-hint")).toHaveCount(0);
  await page.mouse.move(box.x + 12, box.y + 14);
  await page.mouse.down();
  await page.mouse.move(box.x - 48, box.y - 86, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => page.locator(".svg-viewport").evaluate((e) => e.scrollTop))
    .toBeGreaterThan(80);
  await alignment(page, label);
  await page.keyboard.press("Control+s");
  await saved(page);
  await expect(page.locator(".label-editor")).toHaveCount(0);
  expect(await content(page)).toEqual(beforeBrowse);
  expect(writes).toEqual([]);
});

test("image library names, switches, persists drafts, blocks failed saves and deletes independently", async ({
  page,
}) => {
  const a = await seed(page);
  await page.goto("/admin");
  const aLabel = await addLabel(page, "A 图标签");
  await page.getByRole("button", { name: "重命名图片" }).click();
  await page.getByRole("textbox", { name: "图片名称" }).fill("UNet 基线");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  const aItem = page.getByRole("button", {
    name: "打开图片：UNet 基线",
    exact: true,
  });
  await expect(aItem).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`[data-label-id="${aLabel.id}"]`)).toContainText(
    "A 图标签",
  );
  // Identical SVG bytes still represent independently named, annotated images.
  await page.locator('input[type="file"]').setInputFiles({
    name: "UNetPlus.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  const bItem = page.getByRole("button", {
    name: "打开图片：UNetPlus",
    exact: true,
  });
  await expect(bItem).toHaveAttribute("aria-pressed", "true");
  await saved(page);
  const b = await content(page);
  expect(b.id).not.toBe(a.id);
  await expect(page.locator("[data-label-id]")).toHaveCount(0);
  const bLabel = await addLabel(page, "B 图标签");
  await page.locator(`[data-label-id="${bLabel.id}"]`).click();
  await page
    .getByRole("textbox", { name: "标签文字" })
    .fill("B 的草稿随切换保存");
  await aItem.click();
  await expect(aItem).toHaveAttribute("aria-pressed", "true");
  expect((await content(page, b.id)).labels[0].text).toBe("B 的草稿随切换保存");
  await expect(page.locator("[data-label-id]")).toHaveCount(1);
  await expect(page.locator(`[data-label-id="${aLabel.id}"]`)).toContainText(
    "A 图标签",
  );
  // A failed save must leave this image open with its unsaved annotations intact.
  await page.route(`**/api/images/${a.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试保存失败" }),
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  const p = await point(page, 240, 670);
  await page.mouse.click(p.x, p.y);
  await page.getByRole("textbox", { name: "标签文字" }).fill("A 的新增草稿");
  await bItem.click();
  await expect(page.getByRole("alert")).toContainText("测试保存失败");
  await expect(aItem).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-label-id]")).toHaveCount(2);
  expect((await content(page, a.id)).labels).toHaveLength(1);
  await page.unroute(`**/api/images/${a.id}`);
  await page.keyboard.press("Control+s");
  await saved(page);
  await bItem.click();
  await expect(bItem).toHaveAttribute("aria-pressed", "true");
  expect((await content(page, a.id)).labels).toHaveLength(2);
  await page.reload();
  await expect(bItem).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`[data-label-id="${bLabel.id}"]`)).toContainText(
    "B 的草稿随切换保存",
  );
  const display = await page.context().newPage();
  await display.goto("/");
  await expect(
    display.getByRole("button", { name: "打开图片：UNetPlus", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(display.getByRole("button", { name: "删除图片" })).toHaveCount(
    0,
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "删除图片" }).click();
  await expect(bItem).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除图片" }).click();
  await expect(bItem).toHaveCount(0);
  await expect(aItem).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-label-id]")).toHaveCount(2);
  expect((await page.request.get(`/api/images/${b.id}`)).status()).toBe(404);
  // Another idle page follows the deletion without showing annotations on the wrong SVG.
  await expect(
    display.getByRole("button", { name: "打开图片：UNetPlus", exact: true }),
  ).toHaveCount(0, { timeout: 12000 });
  await expect(display.locator(`[data-label-id="${aLabel.id}"]`)).toContainText(
    "A 图标签",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除图片" }).click();
  await expect(page.locator(".empty-svg")).toBeVisible();
  await page.reload();
  await expect(page.locator(".empty-svg")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: "重新添加.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(svg),
  });
  await expect(
    page.getByRole("button", { name: "打开图片：重新添加", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-label-id]")).toHaveCount(0);
  await display.close();
});
