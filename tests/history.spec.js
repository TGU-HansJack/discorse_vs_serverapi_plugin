import { test, expect } from "@playwright/test";

test("normalizes 2016 five-minute slots, preserving gaps and zeros", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { normalizeHistory, historyUrl, calculateDailyBestWindows } = await import("/javascripts/discourse/lib/vsserverapi-history.js");
    const now = Date.parse("2026-10-05T06:30:00Z");
    const [times, values] = normalizeHistory([
      { timestampUtc: "2026-10-05T14:30:00+08:00", onlinePlayers: 0 },
      { timestampUtc: "2026-10-05T06:20:00Z", onlinePlayers: 3 },
      { timestampUtc: "2026-10-05T06:20:00Z", onlinePlayers: 5 },
      { timestampUtc: "2026-09-01T04:00:00Z", onlinePlayers: 99 },
      { timestampUtc: "2026-10-05T07:00:00Z", onlinePlayers: 99 },
      { timestampUtc: "2026-10-05T06:15:00Z", onlinePlayers: null },
      { timestampUtc: "2026-10-05T06:10:00Z", onlinePlayers: -1 },
      { timestampUtc: "2026-10-05T06:21:00Z", onlinePlayers: 8 },
      { timestampUtc: "invalid", onlinePlayers: 9 }, null,
    ], now);
    const dayStart = Date.parse("2026-10-01T00:00:00Z") / 1000;
    const dailyTimes = Array.from({ length: 70 }, (_, i) => dayStart + i * 300);
    const dailyValues = dailyTimes.map((_, i) => i >= 5 && i < 65 ? 9 : 1);
    return { count: times.length, tail: values.slice(-5), valid: values.filter((v) => v !== null),
      url: historyUrl("https://example.com/proxy/api/server/?token=sample#hash"),
      best: calculateDailyBestWindows(dailyTimes, dailyValues).map(({ start, end, average }) => ({ start, end, average })),
      gap: calculateDailyBestWindows(dailyTimes, dailyValues.map((v, i) => i === 35 ? null : v)).length };
  });
  const dayStart = Date.parse("2026-10-01T00:00:00Z") / 1000;
  expect(result).toEqual({ count: 2016, tail: [null, null, 5, null, 0], valid: [5, 0], url: "https://example.com/proxy/api/players/history?token=sample",
    best: [{ start: dayStart + 5 * 300, end: dayStart + 65 * 300, average: 9 }], gap: 0 });
});

test("renders axes and canvas, zooms, scrolls, selects, resets and preserves mod toggle", async ({ page }) => {
  const errors = [];
  const historyRequests = [];
  page.on("request", (request) => { if (request.url().includes("/players/history")) historyRequests.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const chart = page.locator(".vsserverapi-history");
  const scroll = chart.locator(".vsserverapi-history-scroll");
  const zoom = page.getByRole("button", { name: "放大时间轴" });
  const reset = page.getByRole("button", { name: "重置为最近 7 天" });
  await expect(page.locator(".vsserverapi-fields")).not.toContainText(/hourlyPlayerCounts|profileId|playerCountHistory|playerCountIntervalMinutes/);
  await expect(chart).toBeHidden();
  await expect(page.locator(".vsserverapi-mods")).toBeHidden();
  expect(await page.locator(".vsserverapi-history").evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
  await page.getByRole("button", { name: "展开图表和模组列表" }).click();
  await expect(chart).toBeVisible();
  await expect(page.locator(".vsserverapi-mods")).toBeVisible();
  await expect(chart.locator("canvas")).toBeVisible();
  await expect(chart.locator(".u-axis")).toHaveCount(2);
  await expect(chart.locator(".vsserverapi-history-key, .vsserverapi-history-value, .vsserverapi-history-best")).toHaveCount(0);
  await expect(chart.locator(".vsserverapi-history-readout")).toBeHidden();
  await page.screenshot({ path: "test-results/history-desktop-expanded.png", fullPage: true });
  expect(await chart.locator("canvas").evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0).length;
  })).toBeGreaterThan(1000);
  expect(await chart.locator("canvas").evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0 && pixels[i + 1] > pixels[i] + 30 && pixels[i + 2] > pixels[i] + 30) colored++;
    }
    return colored;
  })).toBeGreaterThan(400);
  expect(await chart.locator("canvas").evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > pixels[i + 1] + 30 && pixels[i] > pixels[i + 2] + 30) red++;
    }
    return red;
  })).toBeGreaterThan(20);
  const hoverArea = await chart.locator(".u-over").boundingBox();
  await page.mouse.move(hoverArea.x + hoverArea.width / 2, hoverArea.y + hoverArea.height / 2);
  await expect(chart.locator(".vsserverapi-history-readout")).toBeVisible();
  await expect(chart.locator(".vsserverapi-history-readout")).toContainText("人");
  const hoverAlignment = await chart.evaluate((section) => {
    const readout = section.querySelector(".vsserverapi-history-readout").getBoundingClientRect();
    const cursor = section.querySelector(".u-cursor-x").getBoundingClientRect();
    return { centerDelta: Math.abs(readout.left + readout.width / 2 - (cursor.left + cursor.width / 2)), above: readout.bottom <= cursor.top + 1 };
  });
  expect(hoverAlignment.centerDelta).toBeLessThan(1);
  expect(hoverAlignment.above).toBe(true);
  await page.getByRole("button", { name: "收起图表和模组列表" }).click();
  await expect(chart).toBeHidden();
  await page.getByRole("button", { name: "展开图表和模组列表" }).click();
  await zoom.click();
  await expect(reset).toBeEnabled();
  expect(await scroll.evaluate((el) => el.scrollWidth / el.clientWidth)).toBeCloseTo(2, 1);
  await scroll.focus();
  await page.keyboard.press("End");
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft + el.clientWidth - el.scrollWidth)).toBeCloseTo(0, 0);
  await page.keyboard.press("Home");
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(0);
  await scroll.evaluate((el) => { el.scrollLeft = el.scrollWidth / 4; });
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await reset.click();
  await expect(reset).toBeDisabled();
  const area = await chart.locator(".u-over").boundingBox();
  await page.mouse.move(area.x + 20, area.y + 30);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2, area.y + 50, { steps: 10 });
  await page.mouse.up();
  await expect(reset).toBeEnabled();
  for (let i = 0; i < 6; i++) if (await zoom.isEnabled()) await zoom.click();
  await expect(zoom).toBeDisabled();
  await reset.click();
  await expect(page.getByRole("link", { name: "Carry On" })).toBeVisible();
  await page.getByRole("button", { name: "收起图表和模组列表" }).click();
  await page.screenshot({ path: "test-results/history-desktop.png", fullPage: true });
  await page.evaluate(() => window.addCard());
  await expect(page.locator("canvas")).toHaveCount(2);
  await page.locator("article").evaluate((el) => el.remove());
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "展开图表和模组列表" }).click();
  await zoom.click();
  expect(errors).toEqual([]);
  expect(historyRequests).toEqual([]);
});

test("fallback, legacy, empty, failed and single zero histories do not break the card", async ({ page }) => {
  for (const mode of ["fallback", "legacy", "empty", "error", "zero"]) {
    await page.goto(`/?mode=${mode}`);
    await expect(page.locator(".vsserverapi-title-row h3")).toContainText("Vintage Story");
    await expect(page.locator(".vsserverapi-history")).toBeHidden();
    if (mode === "empty") await expect(page.locator(".vsserverapi-history-status")).toContainText("暂无玩家历史记录");
    else if (mode === "error") await expect(page.locator(".vsserverapi-history-status")).toContainText("HTTP 503");
    else await expect(page.locator("canvas")).toBeAttached();
    await page.getByRole("button", { name: "展开图表和模组列表" }).click();
    if (! ["empty", "error"].includes(mode)) await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("link", { name: "Carry On" })).toBeVisible();
    if (mode === "zero") await expect(page.locator(".vsserverapi-history-readout")).toBeAttached();
  }
});

test("mobile and dark layouts fit, resize and support horizontal touch panning", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + (process.env.PORT || "4179") + "/?dark=1");
  await expect(page.locator("canvas")).toBeAttached();
  await page.getByRole("button", { name: "展开图表和模组列表" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "放大时间轴" }).click();
  const plot = page.locator(".vsserverapi-history-plot");
  const scroll = page.locator(".vsserverapi-history-scroll");
  const before = await scroll.evaluate((el) => el.scrollLeft);
  const bounds = await plot.boundingBox();
  const cdp = await context.newCDPSession(page);
  const touchY = bounds.y + bounds.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 250, y: touchY }] });
  for (const x of [230, 210, 190, 170]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: touchY }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(before);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `test-results/history-mobile-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
  await context.close();
});
