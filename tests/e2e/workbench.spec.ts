import { test, expect, type Page } from "@playwright/test";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 500 600 2400"><rect x="-100" y="500" width="600" height="2400" fill="white"/><g transform="translate(30 650)"><rect width="300" height="140" rx="6" fill="#e8e3fb"/><text x="22" y="80" font-size="24">Attention</text></g><text x="50" y="2820" font-size="24">Output</text></svg>';
const code =
  "import torch\nfrom torch import nn\n\nclass Attention(nn.Module):\n    def forward(self, x):\n        return x\n";
async function seed(page: Page) {
  const current = await (await page.request.get("/api/content")).json();
  const response = await page.request.patch("/api/content", {
    data: {
      revision: current.revision,
      code: { name: "model.py", content: code },
      svg: { name: "model.svg", content: svg },
    },
  });
  expect(response.ok()).toBeTruthy();
}

test("admin edits and uploads; display is read-only and offers half/code/SVG modes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await seed(page);
  await page.goto("/admin");
  await expect(
    page.getByRole("button", { name: "上传代码", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "true",
  );
  await page
    .locator('input[accept=".py,.txt"]')
    .setInputFiles({
      name: "new_model.py",
      mimeType: "text/plain",
      buffer: Buffer.from(code + "\n# uploaded\n"),
    });
  await expect(page.locator(".cm-content")).toContainText("# uploaded");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("# edited\n");
  await page
    .locator('input[accept=".svg,image/svg+xml"]')
    .setInputFiles({
      name: "network.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(svg),
    });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".save-state")).toHaveText("已保存");
  const display = await page.context().newPage();
  await display.goto("http://127.0.0.1:3047/");
  await expect(display.locator(".cm-content")).toContainText("# edited");
  await expect(display.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await expect(
    display.getByRole("button", { name: /上传|保存|绑定|搜索|备注|导出/ }),
  ).toHaveCount(0);
  await expect(display.locator("input[type=file]")).toHaveCount(0);
  const left = await display.locator(".code-pane").boundingBox(),
    right = await display.locator(".svg-pane").boundingBox();
  expect(Math.abs(left!.width - right!.width)).toBeLessThan(2);
  await display.locator(".cm-content").click();
  await display.keyboard.press("Control+Home");
  await display.keyboard.type("SHOULD_NOT_EDIT");
  await expect(display.locator(".cm-content")).not.toContainText(
    "SHOULD_NOT_EDIT",
  );
  await display.getByRole("button", { name: "代码全屏", exact: true }).click();
  await expect(display.locator(".svg-pane")).toBeHidden();
  expect((await display.locator(".code-pane").boundingBox())!.width).toBe(1440);
  await display.getByRole("button", { name: "SVG 全屏", exact: true }).click();
  await expect(display.locator(".code-pane")).toBeHidden();
  await expect(display.locator("#display-svg")).toBeVisible();
  await display.reload();
  await expect(
    display.getByRole("button", { name: "SVG 全屏" }),
  ).toHaveAttribute("aria-pressed", "true");
  await display.getByRole("button", { name: "左右分屏", exact: true }).click();
  await expect(display.locator(".code-pane")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("# live update\n");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(display.locator(".cm-content")).toContainText("# live update", {
    timeout: 10000,
  });
  await page.reload();
  await expect(page.locator(".cm-content")).toContainText("# live update");
  expect(errors).toEqual([]);
});

test("SVG scroll, zoom and touch gestures work in tablet layouts without editing controls", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3047");
  await seed(page);
  await page.reload();
  await expect(page.locator("#display-svg")).toBeVisible();
  const viewport = page.locator(".svg-viewport"),
    box = await viewport.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  const top = await viewport.evaluate((e) => e.scrollTop);
  await page.mouse.wheel(0, 450);
  await expect
    .poll(async () => viewport.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(top + 300);
  const oldScale = parseFloat(await page.locator(".zoom-label").innerText());
  await page.getByRole("button", { name: "放大图片" }).click();
  expect(
    parseFloat(await page.locator(".zoom-label").innerText()),
  ).toBeGreaterThan(oldScale);
  const cdp = await context.newCDPSession(page),
    cx = box!.x + box!.width / 2,
    cy = box!.y + box!.height / 2;
  const beforePinch = parseFloat(await page.locator(".zoom-label").innerText());
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cx - 45, y: cy, id: 0 },
      { x: cx + 45, y: cy, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: cx - 85, y: cy, id: 0 },
      { x: cx + 85, y: cy, id: 1 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => parseFloat(await page.locator(".zoom-label").innerText()))
    .toBeGreaterThan(beforePinch * 1.5);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.getByRole("button", { name: "SVG 全屏", exact: true }).click();
  await expect(page.locator("#display-svg")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "代码全屏", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await context.close();
});
