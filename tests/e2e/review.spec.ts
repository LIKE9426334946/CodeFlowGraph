import { test, expect } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 1180, height: 820 } });

test("display review marks persist, sync across pages and never report a failed save as reviewed", async ({
  page,
}, testInfo) => {
  const gallery = await (await page.request.get("/api/gallery")).json();
  for (const folder of gallery.folders) {
    const response = await page.request.delete(`/api/folders/${folder.id}`, {
      data: { revision: folder.revision },
    });
    expect(response.ok()).toBeTruthy();
  }
  const folderResponse = await page.request.post("/api/folders", {
    data: { name: "学习进度" },
  });
  expect(folderResponse.ok()).toBeTruthy();
  const folderId = (await folderResponse.json()).gallery.activeFolderId;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 2400"><rect width="600" height="2400" fill="white"/><rect x="140" y="240" width="320" height="100" rx="8" fill="#e8e3fb"/><text x="240" y="295" font-size="24">Attention</text></svg>';
  const labels = [
    { id: "saved-label", text: "复习保留的标签", x: 180, y: 400, fontSize: 18 },
  ];
  const images = [];
  for (const name of ["01-Attention", "02-MLP"]) {
    const response = await page.request.post("/api/images", {
      data: {
        folderId,
        name,
        svg: { name: `${name}.svg`, content: svg },
        labels,
      },
    });
    expect(response.ok()).toBeTruthy();
    images.push((await response.json()).image);
  }
  const [first, second] = images;
  expect(
    (
      await page.request.patch(`/api/images/${first.id}`, {
        data: { revision: first.revision, locked: true },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post("/api/gallery/open", { data: { id: first.id } })
    ).ok(),
  ).toBeTruthy();
  const stored = async (id: string) =>
    (await page.request.get(`/api/images/${id}`)).json();
  await page.goto("/");
  const review = page.getByRole("checkbox", { name: "已复习", exact: true });
  const firstRow = page.getByRole("button", {
    name: "打开图片：01-Attention",
    exact: true,
  });
  const secondRow = page.getByRole("button", {
    name: "打开图片：02-MLP",
    exact: true,
  });
  const drawing = page.locator("#display-svg");
  await expect(drawing).toBeVisible();
  await expect(review).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: /固定缩放|适应宽度|浏览器全屏/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "放大图片", exact: true }),
  ).toBeEnabled();
  await page.locator(".svg-viewport").evaluate((e) => {
    e.scrollTop = 220;
  });
  await drawing.evaluate((e) => {
    (window as any).originalDrawing = e;
  });
  const camera = () =>
    drawing.evaluate((e) => {
      const m = (e as SVGSVGElement).getScreenCTM()!;
      return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
  const beforeCamera = await camera();
  const admin = await page.context().newPage();
  await admin.goto("/admin");
  await expect(
    admin.getByRole("button", { name: "固定缩放", exact: true }),
  ).toBeVisible();
  await expect(
    admin.getByRole("button", { name: "适应宽度", exact: true }),
  ).toBeVisible();
  await expect(admin.getByRole("checkbox", { name: "已复习" })).toHaveCount(0);
  await review.click();
  await expect(review).toBeChecked();
  await expect(firstRow).toHaveClass(/reviewed/);
  await expect(secondRow).not.toHaveClass(/reviewed/);
  await expect(page.locator(".save-state")).toHaveText("已保存");
  expect(await camera()).toEqual(beforeCamera);
  expect(
    await drawing.evaluate((e) => e === (window as any).originalDrawing),
  ).toBe(true);
  const reviewed = await stored(first.id);
  expect(reviewed.reviewed).toBe(true);
  expect(reviewed.locked).toBe(true);
  expect(reviewed.svg.content).toBe(svg);
  expect(reviewed.labels).toEqual(labels);
  expect((await stored(second.id)).reviewed).toBe(false);
  await expect(
    admin.getByRole("button", { name: "打开图片：01-Attention", exact: true }),
  ).toHaveClass(/reviewed/, { timeout: 12000 });
  await page.screenshot({ path: testInfo.outputPath("review-mark.png") });
  await secondRow.click();
  await expect(secondRow).toHaveAttribute("aria-pressed", "true");
  await expect(review).not.toBeChecked();
  await expect(firstRow).toHaveClass(/reviewed/);
  await firstRow.click();
  await expect(review).toBeChecked();
  await page.reload();
  await expect(review).toBeChecked();
  await expect(firstRow).toHaveClass(/reviewed/);
  await review.press("Space");
  await expect(review).not.toBeChecked();
  await expect(firstRow).not.toHaveClass(/reviewed/);
  expect((await stored(first.id)).reviewed).toBe(false);
  await expect(
    admin.getByRole("button", { name: "打开图片：01-Attention", exact: true }),
  ).not.toHaveClass(/reviewed/, { timeout: 12000 });
  await page.route(`**/api/images/${first.id}`, (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试复习保存失败" }),
        })
      : route.continue(),
  );
  await review.click();
  await expect(page.getByRole("alert")).toContainText("测试复习保存失败");
  await expect(review).not.toBeChecked();
  await expect(firstRow).not.toHaveClass(/reviewed/);
  expect((await stored(first.id)).reviewed).toBe(false);
  await page.unroute(`**/api/images/${first.id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".review-toggle").tap();
  await expect(review).toBeChecked();
  await expect(page.locator(".review-toggle > span")).toBeVisible();
  expect(
    (await page.locator(".review-toggle").boundingBox())!.height,
  ).toBeGreaterThanOrEqual(44);
  await expect(firstRow).toHaveClass(/reviewed/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.request.post("/api/folders", { data: { name: "空目录" } });
  await page
    .getByRole("button", { name: "打开目录：空目录", exact: true })
    .click();
  await expect(page.locator(".empty-svg")).toBeVisible();
  await expect(review).toBeDisabled();
  await expect(review).not.toBeChecked();
  await admin.close();
});
