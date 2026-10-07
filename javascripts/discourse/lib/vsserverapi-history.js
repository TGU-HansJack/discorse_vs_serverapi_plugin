import uPlot from "./vendor/uplot";

const HOUR = 3600;
const HISTORY_HOURS = 168;
const MIN_WINDOW_HOURS = 3;
const MAX_WINDOW_HOURS = 5;
const MIN_BEST_AVERAGE = 2;
const MIN_SPAN = 6 * HOUR;
const mountedCharts = new Map();
let removalObserver;

export function normalizeHistory(records, now = Date.now(), retentionHours = HISTORY_HOURS) {
  const last = now / 1000;
  const first = last - retentionHours * HOUR;
  const samples = new Map();
  for (const record of records) {
    if (typeof record?.timestampUtc !== "string" || !Number.isInteger(record.onlinePlayers) || record.onlinePlayers < 0) continue;
    const time = Date.parse(record.timestampUtc) / 1000;
    if (Number.isFinite(time) && time >= first && time <= last) samples.set(time, record.onlinePlayers);
  }
  const times = [...samples.keys()].sort((a, b) => a - b);
  return [times, times.map((time) => samples.get(time))];
}

function localDayKey(timestamp) {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateDailyBestWindows(times, values) {
  const windows = new Map();
  if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length || times.length < 2) return [];
  for (let start = 0; start < times.length - 1; start++) {
    for (let endIndex = start + 1; endIndex < times.length; endIndex++) {
      const first = times[start];
      const end = times[endIndex];
      const duration = end - first;
      if (!Number.isFinite(first) || !Number.isFinite(end)) continue;
      if (duration < MIN_WINDOW_HOURS * HOUR) continue;
      if (duration > MAX_WINDOW_HOURS * HOUR) break;
      const day = localDayKey(first);
      let total = 0;
      let covered = 0;
      for (let i = start; i < endIndex; i++) {
        const value = values[i];
        const span = times[i + 1] - times[i];
        if (!Number.isFinite(value) || value < 0 || !Number.isFinite(span) || span <= 0) continue;
        total += value * span;
        covered += span;
      }
      if (covered < duration) continue;
      const average = total / duration;
      if (average < MIN_BEST_AVERAGE) continue;
      const current = windows.get(day);
      if (!current || average > current.average ||
          (average === current.average && (duration > current.end - current.start ||
            (duration === current.end - current.start && first < current.start)))) {
        windows.set(day, { day, start: first, end, average });
      }
    }
  }
  return [...windows.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function historyUrl(apiUrl) {
  const url = new URL(apiUrl);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/server$/, "") + "/players/history";
  url.hash = "";
  return url.href;
}

function trackChart(section, destroy) {
  mountedCharts.get(section)?.();
  mountedCharts.set(section, destroy);
  if (!removalObserver) {
    // Discourse removes cooked posts and composer previews without a component teardown.
    removalObserver = new MutationObserver(() => {
      for (const [element, dispose] of mountedCharts) {
        if (!element.isConnected) {
          dispose();
          mountedCharts.delete(element);
        }
      }
      if (!mountedCharts.size) {
        removalObserver.disconnect();
        removalObserver = null;
      }
    });
    removalObserver.observe(document.body, { childList: true, subtree: true });
  }
}

function chartButton(action, label, icon) {
  return `<button type="button" class="btn no-text btn-flat" data-history-action="${action}" aria-label="${label}" title="${label}" disabled><svg class="fa d-icon d-icon-${icon} svg-icon" width="1em" height="1em" aria-hidden="true"><use href="#${icon}"></use></svg></button>`;
}

export function historyMarkup() {
  return `<section class="vsserverapi-history" aria-label="最近 7 天在线玩家">
    <div class="vsserverapi-history-header"><h4>在线玩家</h4><div class="vsserverapi-history-controls">
      ${chartButton("out", "缩小时间轴", "minus")}
      ${chartButton("in", "放大时间轴", "plus")}
      ${chartButton("reset", "重置为最近 7 天", "rotate-left")}
    </div></div>
    <div class="vsserverapi-history-status" role="status">正在加载玩家历史…</div>
    <div class="vsserverapi-history-plot" role="img" aria-label="在线玩家人数变化图" hidden>
      <div class="vsserverapi-history-readout" role="status" aria-live="polite" hidden></div>
    </div>
    <div class="vsserverapi-history-scroll" tabindex="0" role="region" aria-label="横向滚动玩家历史时间轴" hidden><div></div></div>
  </section>`;
}

function drawHistory(section, data) {
  const host = section.querySelector(".vsserverapi-history-plot");
  const scroll = section.querySelector(".vsserverapi-history-scroll");
  const readout = section.querySelector(".vsserverapi-history-readout");
  const status = section.querySelector("[role=status]");
  const buttons = Object.fromEntries([...section.querySelectorAll("[data-history-action]")].map((button) => [button.dataset.historyAction, button]));
  const min = data[0][0];
  const max = data[0][data[0].length - 1];
  const total = max - min;
  const peak = Math.max(...data[1].filter((value) => value !== null));
  const peakSeries = data[0].map(() => peak);
  const bestWindows = calculateDailyBestWindows(data[0], data[1]);
  const step = Math.max(1, Math.ceil(peak / 5));
  const ceiling = Math.max(5, Math.ceil(peak / step) * step);
  const formatDate = new Intl.DateTimeFormat(undefined, { month: "2-digit", day: "2-digit" });
  const formatTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  const formatFull = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
  let range = { min, max };
  let chart;
  let destroyed = false;
  let scrollFrame;
  let wheelFrame;
  let pendingWheel = 0;
  const color = (name, fallback = "") => getComputedStyle(section).getPropertyValue(name).trim() || fallback;
  const snapCursor = (u, left, top) => {
    if (left < 0) return [left, top];
    const index = u.posToIdx(left);
    return index == null ? [left, top] : [u.valToPos(data[0][index], "x"), top];
  };

  function syncControls() {
    const span = range.max - range.min;
    buttons.in.disabled = span <= MIN_SPAN + 1;
    buttons.out.disabled = buttons.reset.disabled = span >= total - 1;
    scroll.firstElementChild.style.width = `${total / span * 100}%`;
    scroll.scrollLeft = (range.min - min) / total * scroll.scrollWidth;
  }

  function setRange(start, span) {
    span = Math.max(MIN_SPAN, Math.min(total, span));
    start = Math.max(min, Math.min(max - span, start));
    chart.setScale("x", { min: start, max: start + span });
  }

  function zoom(factor) {
    const span = range.max - range.min;
    const nextSpan = Math.max(MIN_SPAN, Math.min(total, span * factor));
    setRange((range.min + range.max - nextSpan) / 2, nextSpan);
  }

  status.hidden = true;
  host.hidden = scroll.hidden = false;
  readout.hidden = true;
  chart = new uPlot({
    width: Math.max(1, Math.floor(host.clientWidth)),
    height: 248,
    padding: [28, 16, 0, 0],
    legend: { show: false },
    cursor: { drag: { x: true, y: false, setScale: false }, move: snapCursor, y: false },
    scales: { x: { min, max }, y: { range: () => [0, ceiling] } },
    series: [
      {},
      { label: "在线玩家", stroke: () => color("--tertiary", "#008c99"), width: 2.5, spanGaps: false, points: { show: false } },
      { label: "最大值", stroke: () => color("--danger", "#d64545"), width: 1.5, dash: [6, 5], points: { show: false } }
    ],
    axes: [
      { label: "时间", size: 54, labelSize: 22, space: 100, font: "12px sans-serif", stroke: () => color("--primary-medium"), grid: { show: false }, border: { show: true, stroke: () => color("--primary-medium"), width: 1 },
        values: (_u, ticks) => ticks.map((time) => `${formatDate.format(time * 1000)}\n${formatTime.format(time * 1000)}`) },
      { label: "人数", size: 42, labelSize: 22, font: "12px sans-serif", stroke: () => color("--primary-medium"), grid: { show: false }, ticks: { show: false },
        splits: () => Array.from({ length: Math.floor(ceiling / step) + 1 }, (_, i) => i * step) }
    ],
    hooks: {
      drawClear: [(u) => {
        if (!bestWindows.length) return;
        const { ctx, bbox } = u;
        ctx.save();
        ctx.beginPath();
        ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
        ctx.clip();
        ctx.fillStyle = color("--success-low", "rgba(36, 130, 63, .16)");
        // drawClear paints the full canvas, so use uPlot's canvas-space coordinates.
        for (const window of bestWindows) {
          const left = Math.max(bbox.left, u.valToPos(window.start, "x", true));
          const right = Math.min(bbox.left + bbox.width, u.valToPos(window.end, "x", true));
          if (right > left) ctx.fillRect(left, bbox.top, right - left, bbox.height);
        }
        ctx.restore();
      }],
      setScale: [(u, key) => {
        if (key === "x") {
          range = { min: u.scales.x.min, max: u.scales.x.max };
          syncControls();
        }
      }],
      setSelect: [(u) => {
        if (u.select.width > 5) {
          const start = u.posToVal(u.select.left, "x");
          const end = u.posToVal(u.select.left + u.select.width, "x");
          setRange(start, end - start);
          u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
        }
      }],
      setCursor: [(u) => {
        const index = u.cursor.idx;
        if (index == null) {
          readout.hidden = true;
          return;
        }
        readout.textContent = `${formatFull.format(data[0][index] * 1000)} · ${data[1][index] === null ? "无记录" : `${data[1][index]} 人`}`;
        readout.hidden = false;
        const cursorLeft = u.over.offsetLeft + u.cursor.left;
        const halfWidth = readout.offsetWidth / 2;
        const minLeft = halfWidth;
        const maxLeft = Math.max(minLeft, host.clientWidth - halfWidth);
        readout.style.left = `${Math.min(maxLeft, Math.max(minLeft, cursorLeft))}px`;
      }]
    }
  }, [data[0], data[1], peakSeries], host);
  syncControls();

  const events = new AbortController();
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: events.signal });
  listen(buttons.in, "click", () => zoom(0.5));
  listen(buttons.out, "click", () => zoom(2));
  listen(buttons.reset, "click", () => setRange(min, total));
  listen(scroll, "scroll", () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      const start = min + scroll.scrollLeft / scroll.scrollWidth * total;
      // Ignore scroll events generated by syncControls and native pixel rounding.
      if (Math.abs(start - range.min) > total / scroll.scrollWidth) setRange(start, range.max - range.min);
    });
  }, { passive: true });
  listen(scroll, "keydown", (event) => {
    const span = range.max - range.min;
    const positions = { ArrowLeft: range.min - span / 4, ArrowRight: range.min + span / 4, Home: min, End: max - span };
    if (event.key in positions) {
      event.preventDefault();
      setRange(positions[event.key], span);
    }
  });
  listen(host, "wheel", (event) => {
    if (event.ctrlKey || event.metaKey) return;
    const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
    if (!delta || range.max - range.min >= total - 1) return;
    event.preventDefault();
    pendingWheel += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientWidth : 1);
    cancelAnimationFrame(wheelFrame);
    wheelFrame = requestAnimationFrame(() => {
      setRange(range.min + pendingWheel / host.clientWidth * (range.max - range.min), range.max - range.min);
      pendingWheel = 0;
    });
  }, { passive: false });
  let touch;
  listen(host, "touchstart", (event) => {
    touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY, range: { ...range } } : null;
  }, { passive: true });
  listen(host, "touchmove", (event) => {
    if (!touch || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - touch.x;
    const dy = event.touches[0].clientY - touch.y;
    if (Math.abs(dx) <= Math.abs(dy) || touch.range.max - touch.range.min >= total - 1) return;
    event.preventDefault();
    setRange(touch.range.min - dx / host.clientWidth * (touch.range.max - touch.range.min), touch.range.max - touch.range.min);
  }, { passive: false });
  listen(host, "touchend", () => { touch = null; }, { passive: true });
  listen(host, "touchcancel", () => { touch = null; }, { passive: true });

  const resize = new ResizeObserver(() => {
    if (destroyed || !host.clientWidth) return;
    chart.setSize({ width: Math.floor(host.clientWidth), height: 248 });
    syncControls();
  });
  resize.observe(host);
  trackChart(section, () => {
    destroyed = true;
    events.abort();
    resize.disconnect();
    cancelAnimationFrame(scrollFrame);
    cancelAnimationFrame(wheelFrame);
    chart.destroy();
  });
}

export async function loadHistory(section, serverData, apiUrl) {
  if (!section) return;
  const status = section.querySelector("[role=status]");
  try {
    let records = serverData.playerCountHistory;
    if (!Array.isArray(records)) {
      const response = await fetch(historyUrl(apiUrl), {
        headers: { Accept: "application/json" }, credentials: "omit", signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      records = payload?.history;
    }
    if (!Array.isArray(records)) throw new Error("历史数据格式无效");
    if (!section.isConnected) return;
    const data = normalizeHistory(records, Date.now(), serverData.playerCountHistoryHours || 168);
    if (data[1].every((value) => value === null)) {
      status.textContent = "最近 7 天暂无玩家历史记录";
      return;
    }
    section.querySelector(".vsserverapi-history-plot").setAttribute("aria-label", "在线玩家人数变化图");
    drawHistory(section, data);
  } catch (error) {
    status.hidden = false;
    status.textContent = `无法加载玩家历史：${error.message || "请求失败"}`;
  }
}
