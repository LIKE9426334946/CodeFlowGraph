import { test, expect, type Page } from "@playwright/test";

test.use({ hasTouch: true });
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 2400"><rect width="600" height="2400" fill="white"/><rect x="160" y="80" width="280" height="100" rx="8" fill="#e8e3fb"/><text x="240" y="140" font-size="24">Attention</text><text x="240" y="2300">Output</text></svg>';
const label = {
  id: "kept_label",
  text: "Saved label",
  x: 100,
  y: 260,
  fontSize: 16,
};

async function seed(page: Page) {
  const gallery = await (await page.request.get("/api/gallery")).json();
  for (const folder of gallery.folders)
    expect(
      (
        await page.request.delete(`/api/folders/${folder.id}`, {
          data: { revision: folder.revision },
        })
      ).ok(),
    ).toBeTruthy();
  const result = await page.request.post("/api/folders", {
    data: { name: "Models" },
  });
  const folderId = (await result.json()).gallery.activeFolderId;
  const images = [];
  for (const name of ["01-Attention", "02-MLP"]) {
    const response = await page.request.post("/api/images", {
      data: {
        folderId,
        name,
        svg: { name: `${name}.svg`, content: svg },
        labels: [label],
      },
    });
    expect(response.ok()).toBeTruthy();
    images.push((await response.json()).image);
  }
  await page.request.post("/api/gallery/open", { data: { id: images[0].id } });
  return images;
}
const stored = async (page: Page, id: string) =>
  (await page.request.get(`/api/images/${id}`)).json();
const saved = (page: Page) =>
  expect(page.locator(".save-state")).toHaveText("已保存");

test("fixed code keeps original lines and indentation while SVG and code scroll independently", async ({
  page,
}, testInfo) => {
  const [first] = await seed(page);
  await page.goto("/admin");
  await expect(page.locator("#display-svg")).toBeVisible();
  await expect(page.locator(".code-panel")).toHaveCount(0);
  await expect(page.locator(".add-label + .add-code")).toBeVisible();
  await page.getByRole("button", { name: "增加代码", exact: true }).click();
  const input = page.getByRole("textbox", { name: "代码内容" });
  await input.fill("if x:\n");
  await input.press("Tab");
  await expect(input).toHaveValue("if x:\n\t");
  const source =
    '\nclass Attention:\n\tdef forward(self, x):\n        note = "<img src=x onerror=alert(1)>"\n        # ' +
    "one original long line ".repeat(65) +
    "\n\n" +
    Array.from(
      { length: 70 },
      (_, i) => `        x = self.layers[${i}](x)  `,
    ).join("\n") +
    "\n        return x\n\n";
  await input.fill(source);
  await expect(input).toHaveAttribute("wrap", "off");
  await expect(input).toHaveCSS("white-space", "pre");
  expect(await input.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "保存代码", exact: true }).click();
  await saved(page);
  expect((await stored(page, first.id)).code).toBe(source);
  const display = await page.context().newPage();
  await display.goto("/");
  for (const current of [page, display]) {
    const panel = current.locator(".code-panel");
    const codeScroll = current.locator(".code-scroll");
    const codeText = current.locator(".code-scroll code");
    const view = current.locator(".svg-viewport");
    await expect(codeText).toBeVisible();
    expect(await codeText.textContent()).toBe(source);
    await expect(current.locator(".code-scroll img")).toHaveCount(0);
    await expect(current.locator(".code-scroll pre")).toHaveCSS(
      "white-space",
      "pre",
    );
    expect(
      await codeScroll.evaluate((e) => e.scrollWidth > e.clientWidth),
    ).toBe(true);
    const panelBox = (await panel.boundingBox())!;
    const viewBox = (await view.boundingBox())!;
    expect(panelBox.x + panelBox.width).toBeCloseTo(viewBox.x, 1);
    expect(panelBox.y).toBe(0);
    expect(panelBox.height).toBe(960);
    await view.evaluate((e) => {
      e.scrollTop = 350;
    });
    await current.mouse.move(viewBox.x + viewBox.width / 2, 500);
    await current.mouse.down();
    await current.mouse.move(viewBox.x + viewBox.width / 2, 300, { steps: 8 });
    await current.mouse.up();
    await expect
      .poll(() => view.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(500);
    expect(await panel.boundingBox()).toEqual(panelBox);
    expect(await codeScroll.evaluate((e) => e.scrollTop)).toBe(0);
    const beforeSvgScroll = await view.evaluate((e) => e.scrollTop);
    await current.mouse.move(panelBox.x + panelBox.width / 2, 400);
    await current.mouse.wheel(0, 320);
    await expect
      .poll(() => codeScroll.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(200);
    expect(await view.evaluate((e) => e.scrollTop)).toBe(beforeSvgScroll);
    await current.mouse.wheel(360, 0);
    await expect
      .poll(() => codeScroll.evaluate((e) => e.scrollLeft))
      .toBeGreaterThan(200);
    const codePosition = await codeText.boundingBox();
    const font = await codeText.evaluate((e) => getComputedStyle(e).fontSize);
    await current
      .getByRole("button", { name: "放大图片", exact: true })
      .click();
    expect(await codeText.boundingBox()).toEqual(codePosition);
    expect(await codeText.evaluate((e) => getComputedStyle(e).fontSize)).toBe(
      font,
    );
  }
  await expect(
    display.getByRole("button", {
      name: /增加代码|编辑图片代码|编辑代码|删除代码|保存代码/,
    }),
  ).toHaveCount(0);
  await expect(display.getByRole("textbox", { name: "代码内容" })).toHaveCount(
    0,
  );
  await display.getByRole("checkbox", { name: "已复习" }).click();
  await expect(display.getByRole("checkbox", { name: "已复习" })).toBeChecked();
  expect((await stored(page, first.id)).code).toBe(source);
  await display.reload();
  expect(await display.locator(".code-scroll code").textContent()).toBe(source);
  await display.setViewportSize({ width: 1180, height: 820 });
  const scroll = display.locator(".code-scroll");
  await scroll.evaluate((e) => {
    e.scrollTop = 0;
    e.scrollLeft = 0;
  });
  const codeBox = (await scroll.boundingBox())!;
  const beforeTouchSvg = await display
    .locator(".svg-viewport")
    .evaluate((e) => e.scrollTop);
  const cdp = await display.context().newCDPSession(display);
  const x = codeBox.x + codeBox.width / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: 600, id: 0 }],
  });
  for (const y of [550, 500, 450, 400])
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y, id: 0 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() => scroll.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(100);
  expect(
    await display.locator(".svg-viewport").evaluate((e) => e.scrollTop),
  ).toBe(beforeTouchSvg);
  await display.getByRole("button", { name: "隐藏侧边栏" }).click();
  await expect(display.locator(".code-panel")).toBeVisible();
  await expect(display.locator("#display-svg")).toBeVisible();
  await scroll.evaluate((e) => {
    e.scrollTop = 0;
    e.scrollLeft = 0;
  });
  await display.screenshot({
    path: testInfo.outputPath("fixed-code-panel.png"),
  });
  await display.close();
});

test("code drafts save with labels before switching, survive failures, and obey locks and deletion", async ({
  page,
}) => {
  const [first, second] = await seed(page);
  await page.goto("/admin");
  await page.locator('[data-label-id="kept_label"]').click();
  await page.getByRole("textbox", { name: "标签文字" }).fill("Changed label");
  await page.getByRole("button", { name: "增加代码", exact: true }).click();
  const input = page.getByRole("textbox", { name: "代码内容" });
  const firstCode = "def forward(x):\n    return x\n";
  await input.fill(firstCode);
  const a = page.getByRole("button", {
    name: "打开图片：01-Attention",
    exact: true,
  });
  const b = page.getByRole("button", { name: "打开图片：02-MLP", exact: true });
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "true");
  expect((await stored(page, first.id)).code).toBe(firstCode);
  expect((await stored(page, first.id)).labels[0].text).toBe("Changed label");
  expect((await stored(page, second.id)).code).toBe("");
  await expect(page.locator(".code-panel")).toHaveCount(0);
  await a.click();
  await expect(page.locator(".code-scroll code")).toBeVisible();
  await page.getByRole("button", { name: "编辑图片代码", exact: true }).click();
  await input.fill("discarded");
  await page
    .locator(".code-form")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(await page.locator(".code-scroll code").textContent()).toBe(firstCode);
  await page.getByRole("button", { name: "编辑图片代码", exact: true }).click();
  const draft = "\n\tdef forward(x):\n\t\treturn x + 1  \n";
  await input.fill(draft);
  await page.route(`**/api/images/${first.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试代码保存失败" }),
        })
      : route.continue(),
  );
  await b.click();
  await expect(page.getByRole("alert")).toContainText("测试代码保存失败");
  await expect(a).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".code-scroll code").textContent()).toBe(draft);
  expect((await stored(page, first.id)).code).toBe(firstCode);
  await page.unroute(`**/api/images/${first.id}`);
  await page.getByRole("button", { name: "重试保存" }).click();
  await saved(page);
  expect((await stored(page, first.id)).code).toBe(draft);
  await page.getByRole("button", { name: "编辑图片代码", exact: true }).click();
  await input.fill(draft + "# before lock\n");
  await page.getByRole("button", { name: "锁定图片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "解锁图片", exact: true }),
  ).toBeVisible();
  expect((await stored(page, first.id)).code).toBe(draft + "# before lock\n");
  await expect(
    page.getByRole("button", { name: "编辑图片代码", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "删除代码", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "编辑图片代码", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "解锁图片", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "删除代码", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除代码", exact: true }).click();
  await saved(page);
  await expect(page.locator(".code-panel")).toHaveCount(0);
  expect((await stored(page, first.id)).code).toBe("");
  expect((await stored(page, first.id)).labels[0].text).toBe("Changed label");
});
