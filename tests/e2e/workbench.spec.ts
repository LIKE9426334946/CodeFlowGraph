import { test, expect, type Page } from "@playwright/test";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 500 600 2400"><style>text{fill:#506080;font-size:24px}rect{stroke:#aaa}</style><rect x="-100" y="500" width="600" height="2400" fill="white"/><g transform="translate(30 650)"><rect width="300" height="140" rx="6" fill="#e8e3fb"/><text x="22" y="80">Attention</text></g><text x="50" y="2820">Output</text></svg>';
async function seed(page: Page) {
  const current = await (await page.request.get("/api/content")).json();
  expect(
    (
      await page.request.patch("/api/content", {
        data: {
          revision: current.revision,
          svg: { name: "model.svg", content: svg },
          labels: [],
        },
      })
    ).ok(),
  ).toBeTruthy();
}
async function saved(page: Page) {
  await expect(page.locator(".save-state")).toHaveText("已保存");
}
async function content(page: Page) {
  return (await page.request.get("/api/content")).json();
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

test("full-page SVG supports create/edit/drag/zoom/sync/delete labels without rebuilding the drawing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seed(page);
  await page.goto("/admin");
  await expect(page.locator(".cm-editor, .code-pane")).toHaveCount(0);
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "network.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(svg),
    });
  await saved(page);
  await page.goto("/");
  await expect(page.locator("#display-svg")).toBeVisible();
  expect((await page.locator(".svg-viewport").boundingBox())!.width).toBe(1440);
  expect((await page.locator(".svg-viewport").boundingBox())!.height).toBe(960);
  await expect(page.locator("input[type=file], .cm-editor")).toHaveCount(0);
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
  // Replacement is explicit and removes annotations belonging to the previous drawing.
  await addLabel(page, "旧图标签");
  await page.goto("/admin");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "replacement.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(svg.replace("Attention", "Replaced")),
    });
  await saved(page);
  await expect(page.locator("[data-label-id]")).toHaveCount(0);
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
  await page.goto("http://127.0.0.1:3047/");
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
  await context.close();
});
