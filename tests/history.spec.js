import { test, expect } from "@playwright/test";

test("normalizes on-change history and preserves irregular timestamps", async ({ page }) => {
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
    const toleratedGap = dailyValues.map((v, i) => i >= 35 && i < 38 ? null : v);
    const rejectedGap = dailyValues.map((v, i) => i >= 35 && i < 39 ? null : v);
    const localEvening = new Date(2026, 9, 1, 23, 0, 0).getTime() / 1000;
    const flexibleTimes = Array.from({ length: 37 }, (_, i) => localEvening + i * 300);
    const flexibleValues = flexibleTimes.map((_, i) => i < 36 ? 20 : 1);
    return { count: times.length, times, values, valid: values.filter((v) => v !== null),
      url: historyUrl("https://example.com/proxy/api/server/?token=sample#hash"),
      best: calculateDailyBestWindows(dailyTimes, dailyValues).map(({ start, end, average }) => ({ start, end, average })),
      toleratedGap: calculateDailyBestWindows(dailyTimes, toleratedGap).map(({ start, end, average }) => ({ start, end, average })),
      rejectedGap: calculateDailyBestWindows(dailyTimes, rejectedGap).some(({ average }) => average === 9),
      flexible: calculateDailyBestWindows(flexibleTimes, flexibleValues).map(({ day, start, end, average }) => ({ day, start, end, average })) };
  });
  const dayStart = Date.parse("2026-10-01T00:00:00Z") / 1000;
  expect(result).toEqual({ count: 3, times: [Date.parse("2026-10-05T06:20:00Z") / 1000, Date.parse("2026-10-05T06:21:00Z") / 1000, Date.parse("2026-10-05T14:30:00+08:00") / 1000], values: [5, 8, 0], valid: [5, 8, 0], url: "https://example.com/proxy/api/players/history?token=sample",
    best: [{ start: dayStart + 5 * 300, end: dayStart + 65 * 300, average: 9 }],
    toleratedGap: [], rejectedGap: false,
    flexible: [{ day: "2026-10-01", start: new Date(2026, 9, 1, 23, 0, 0).getTime() / 1000,
      end: new Date(2026, 9, 2, 2, 0, 0).getTime() / 1000, average: 20 }] });
});

test("selects three-to-five-hour windows and assigns cross-midnight windows by local start date", async ({ browser }) => {
  const context = await browser.newContext({ timezoneId: "Asia/Shanghai" });
  const page = await context.newPage();
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { calculateDailyBestWindows } = await import("/javascripts/discourse/lib/vsserverapi-history.js");
    const start = Date.parse("2026-10-01T15:00:00Z") / 1000;
    const exactThreeTimes = Array.from({ length: 37 }, (_, i) => start + i * 300);
    const exactThreeValues = exactThreeTimes.map(() => 20);
    const fractionalHourTimes = Array.from({ length: 42 }, (_, i) => start + i * 300);
    const fractionalHourValues = fractionalHourTimes.map(() => 20);
    const fiveHourTimes = Array.from({ length: 61 }, (_, i) => start + i * 300);
    const fiveHourValues = fiveHourTimes.map(() => 20);
    const emptyTimes = Array.from({ length: 61 }, (_, i) => start + i * 300);
    const emptyValues = emptyTimes.map(() => 0);
    const lowTimes = Array.from({ length: 37 }, (_, i) => start + i * 300);
    const lowValues = lowTimes.map((_, i) => i < 12 ? Math.max(0, 6 - Math.floor(i / 2)) : 0);
    const irregularTimes = Array.from({ length: 36 }, (_, i) => start + (i === 18 ? 19 : i) * 300);
    const irregularValues = irregularTimes.map(() => 20);
    const summarize = (windows) => windows.map(({ day, start: windowStart, end, average }) => ({
      day, start: windowStart, end, duration: end - windowStart, average,
    }));
    return {
      exactThree: summarize(calculateDailyBestWindows(exactThreeTimes, exactThreeValues)),
      fractionalHour: summarize(calculateDailyBestWindows(fractionalHourTimes, fractionalHourValues)),
      fiveHourCrossMidnight: summarize(calculateDailyBestWindows(fiveHourTimes, fiveHourValues)),
      empty: calculateDailyBestWindows(emptyTimes, emptyValues),
      low: calculateDailyBestWindows(lowTimes, lowValues),
      irregular: calculateDailyBestWindows(irregularTimes, irregularValues),
    };
  });
  const start = Date.parse("2026-10-01T15:00:00Z") / 1000;
  expect(result).toEqual({
    exactThree: [{ day: "2026-10-01", start, end: start + 3 * 3600, duration: 3 * 3600, average: 20 }],
    fractionalHour: [{ day: "2026-10-01", start, end: start + 3 * 3600 + 25 * 60, duration: 3 * 3600 + 25 * 60, average: 20 }],
    fiveHourCrossMidnight: [
      { day: "2026-10-01", start, end: start + 5 * 3600, duration: 5 * 3600, average: 20 },
      { day: "2026-10-02", start: start + 3600, end: start + 5 * 3600, duration: 4 * 3600, average: 20 },
    ],
    empty: [],
    low: [],
    irregular: [],
  });
  await context.close();
});

test("renders axes and canvas, zooms, pans, selects, resets and preserves mod toggle", async ({ page }) => {
  const errors = [];
  const historyRequests = [];
  page.on("request", (request) => { if (request.url().includes("/players/history")) historyRequests.push(request.url()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const chart = page.locator(".vsserverapi-history");
  const panSlider = page.getByRole("slider", { name: "横向移动时间轴" });
  const zoom = page.getByRole("button", { name: "放大时间轴" });
  const reset = page.getByRole("button", { name: "重置为最近 7 天" });
  await expect(page.locator(".vsserverapi-fields")).not.toContainText(/profileId|playerCountHistory|playerCountHistoryMode|playerCountHistoryHours/);
  await expect(page.locator(".vsserverapi-fields")).not.toContainText(/配置|服务器状态|服务器地址|最大玩家数/);
  await expect(page.locator(".vsserverapi-fields")).toContainText("世界名称");
  await expect(page.locator(".vsserverapi-fields")).not.toContainText(/profileName|serverStatus|address|maxPlayers/);
  await expect(chart).toBeHidden();
  await expect(page.locator(".vsserverapi-mods")).toBeHidden();
  expect(await page.locator(".vsserverapi-history").evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
  await page.getByRole("button", { name: "展开图表和模组列表" }).click();
  await expect(chart).toBeVisible();
  await expect(page.locator(".vsserverapi-mods")).toBeVisible();
  await expect(page.locator(".vsserverapi-mods h4")).toHaveText("模组列表");
  await expect(page.locator(".vsserverapi-mods h4 span")).toHaveCount(0);
  await expect(page.locator(".vsserverapi-mod-card")).toHaveCount(1);
  await expect(page.locator(".vsserverapi-mod-card")).toContainText(/Carry On.*v1\.0\.0.*CreativeMode/);
  await expect(page.getByRole("link", { name: "下载 Carry On 的最新版本" })).toBeVisible();
  await expect(chart.locator("canvas")).toBeVisible();
  await expect(chart.locator(".vsserverapi-history-scroll")).toHaveCount(0);
  await expect(panSlider).toBeDisabled();
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
  const greenBands = () => chart.locator("canvas").evaluate((canvas) => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const columns = [];
    for (let x = 0; x < canvas.width; x++) {
      let count = 0;
      for (let y = 0; y < canvas.height; y++) {
        const offset = (y * canvas.width + x) * 4;
        if (pixels[offset] === 225 && pixels[offset + 1] === 242 && pixels[offset + 2] === 231 && pixels[offset + 3] === 255) count++;
      }
      if (count > 10) columns.push(x);
    }
    return columns.reduce((groups, x) => {
      if (!groups.length || x > groups.at(-1).at(-1) + 1) groups.push([x]);
      else groups.at(-1).push(x);
      return groups;
    }, []).map((group) => [group[0], group.at(-1)]);
  });
  const initialGreenBands = await greenBands();
  expect(initialGreenBands.length).toBeGreaterThan(0);
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
  for (const x of [hoverArea.x + 1, hoverArea.x + hoverArea.width - 1]) {
    await page.mouse.move(x, hoverArea.y + hoverArea.height / 2);
    await expect.poll(() => chart.locator(".vsserverapi-history-readout").evaluate((readout) => ({
      whiteSpace: getComputedStyle(readout).whiteSpace,
      singleLine: readout.scrollHeight <= readout.clientHeight + 1,
    }))).toEqual({ whiteSpace: "nowrap", singleLine: true });
  }
  await page.getByRole("button", { name: "收起图表和模组列表" }).click();
  await expect(chart).toBeHidden();
  await page.getByRole("button", { name: "展开图表和模组列表" }).click();
  await zoom.click();
  await expect(reset).toBeEnabled();
  await expect(panSlider).toBeEnabled();
  const zoomedGreenBands = await greenBands();
  const plotBounds = await chart.locator(".u-over").evaluate((element) => ({ left: element.offsetLeft, width: element.clientWidth }));
  const plotCenter = plotBounds.left + plotBounds.width / 2;
  const transformErrors = initialGreenBands.flatMap(([left, right]) => {
    const expected = plotCenter + ((left + right) / 2 - plotCenter) * 2;
    return zoomedGreenBands.map(([nextLeft, nextRight]) => Math.abs((nextLeft + nextRight) / 2 - expected));
  });
  expect(Math.min(...transformErrors)).toBeLessThan(4);
  const beforePan = await chart.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  await panSlider.focus();
  await page.keyboard.press("End");
  await expect(panSlider).toHaveValue("100");
  await expect.poll(() => chart.locator("canvas").evaluate((canvas) => canvas.toDataURL())).not.toBe(beforePan);
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect(panSlider).toBeDisabled();
  await expect(panSlider).toHaveValue("0");
  const area = await chart.locator(".u-over").boundingBox();
  await page.mouse.move(area.x + 20, area.y + 30);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2, area.y + 50, { steps: 10 });
  await page.mouse.up();
  await expect(reset).toBeEnabled();
  for (let i = 0; i < 6; i++) if (await zoom.isEnabled()) await zoom.click();
  await expect(zoom).toBeDisabled();
  await expect(panSlider).toBeEnabled();
  await reset.click();
  await expect(page.getByRole("link", { name: "Carry On" })).toBeVisible();
  await page.getByRole("button", { name: "收起图表和模组列表" }).click();
  await page.screenshot({ path: "test-results/history-desktop.png", fullPage: true });
  await page.evaluate(() => window.addCard());
  await expect(page.locator("canvas")).toHaveCount(2);
  await page.locator("article:not(.vsserverapi-mod-card)").evaluate((el) => el.remove());
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "展开图表和模组列表" }).click();
  await zoom.click();
  expect(errors).toEqual([]);
  expect(historyRequests).toEqual([]);
});

test("fallback, empty, failed and single zero histories do not break the card", async ({ page }) => {
  for (const mode of ["fallback", "empty", "error", "zero"]) {
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
  await expect(page.locator(".vsserverapi-history-scroll")).toHaveCount(0);
  const before = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL());
  const bounds = await plot.boundingBox();
  const cdp = await context.newCDPSession(page);
  const touchY = bounds.y + bounds.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 250, y: touchY }] });
  for (const x of [230, 210, 190, 170]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: touchY }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.locator("canvas").evaluate((canvas) => canvas.toDataURL())).not.toBe(before);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `test-results/history-mobile-${width}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
  await context.close();
});
