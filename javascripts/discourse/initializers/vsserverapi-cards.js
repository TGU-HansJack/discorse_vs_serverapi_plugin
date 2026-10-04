import { withPluginApi } from "discourse/lib/plugin-api";

const DISPLAY_FIELDS = [
  ["profileName", "配置"],
  ["version", "游戏版本"],
  ["isRunning", "运行状态"],
  ["onlinePlayers", "在线玩家"],
  ["startedAtUtc", "启动时间"],
  ["uptimeSeconds", "运行时长"]
];

function normalizeApiUrl(value) {
  const source = String(value || "").trim()
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  const href = source.match(/href\s*=\s*["']([^"']+)["']/i);
  const explicitUrl = source.match(/https?:\/\/[^\s<>"']+/i);
  const bareUrl = source.match(/(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+)(?::\d+)(?:\/[^\s<>"']*)?/i);
  const input = (href?.[1] || explicitUrl?.[0] || bareUrl?.[0] || source).trim();
  if (!input) return null;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  try {
    const url = new URL(withProtocol, window.location.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return null;
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return [days ? `${days} 天` : "", hours ? `${hours} 小时` : "", minutes ? `${minutes} 分钟` : "", `${secs} 秒`]
    .filter(Boolean).join(" ");
}

function resolveAssetUrl(value, apiUrl) {
  if (!value) return "";
  try {
    const url = new URL(String(value), apiUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderInfo(data) {
  const known = new Set(DISPLAY_FIELDS.map(([key]) => key).concat(["serverName", "description", "coverUrl", "mods"]));
  const rows = [];
  for (const [key, label] of DISPLAY_FIELDS) {
    if (!(key in data)) continue;
    let value = data[key];
    if (key === "isRunning") value = data[key] ? "运行中" : "已停止";
    if (key === "uptimeSeconds") value = formatDuration(data[key]) || formatValue(data[key]);
    rows.push(`<div class="vsserverapi-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatValue(value))}</dd></div>`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (known.has(key)) continue;
    rows.push(`<div class="vsserverapi-field"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatValue(value))}</dd></div>`);
  }
  return rows.join("");
}

function renderMods(mods) {
  if (!Array.isArray(mods)) return "";
  const tags = mods.map((mod) => {
    const name = mod && (mod.name || mod.modId);
    if (!name) return "";
    const url = mod.url && /^https?:\/\//i.test(String(mod.url)) ? String(mod.url) : "";
    const tag = `<span class="vsserverapi-mod-tag">${escapeHtml(name)}</span>`;
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${tag}</a>` : tag;
  }).filter(Boolean).join("");
  return `<section class="vsserverapi-mods"><h4>模组列表 <span>${mods.length}</span></h4><div class="vsserverapi-mod-tags">${tags || "<span class=\"vsserverapi-empty\">暂无模组</span>"}</div></section>`;
}

function renderCard(container, data, apiUrl) {
  const card = container.querySelector("[data-vsserverapi-card]");
  if (!card) return;
  const cover = resolveAssetUrl(data.coverUrl, apiUrl);
  const title = data.serverName || data.profileName || "Vintage Story 服务器";
  const hasStatus = typeof data.isRunning === "boolean";
  const statusClass = hasStatus ? (data.isRunning ? "is-online" : "is-offline") : "is-unknown";
  const statusText = hasStatus ? (data.isRunning ? "运行中" : "已停止") : "状态未知";
  const description = data.description ? `<p class="vsserverapi-description">${escapeHtml(data.description)}</p>` : "";
  card.innerHTML = `<div class="vsserverapi-main">` +
    `<div class="vsserverapi-cover-wrap">${cover ? `<img class="vsserverapi-cover" src="${escapeHtml(cover)}" alt="" loading="lazy">` : `<div class="vsserverapi-cover-placeholder" aria-hidden="true">VS</div>`}</div>` +
    `<div class="vsserverapi-summary"><div class="vsserverapi-title-row"><h3>${escapeHtml(title)}</h3><span class="vsserverapi-status ${statusClass}">${statusText}</span></div>${description}<dl class="vsserverapi-fields">${renderInfo(data)}</dl></div></div>` +
    renderMods(data.mods);
  const image = card.querySelector("img");
  if (image) image.addEventListener("error", () => image.replaceWith(Object.assign(document.createElement("div"), { className: "vsserverapi-cover-placeholder", textContent: "VS" })), { once: true });
}

function showError(container, message) {
  const card = container.querySelector("[data-vsserverapi-card]");
  if (card) card.innerHTML = `<div class="vsserverapi-error" role="alert">${escapeHtml(message)}</div>`;
}

function escapeAttribute(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function convertMarkdownMarkers(element) {
  const marker = /\[vsserverapi(?:=([^\]\r\n]+))?\]\s*([\s\S]*?)\s*\[vsserverapi\]/gi;
  if (!marker.test(element.innerHTML)) return;
  marker.lastIndex = 0;
  element.innerHTML = element.innerHTML.replace(marker, (_match, rawUrl, body) =>
    `<div class="vsserverapi-embed" data-vsserverapi-url="${escapeAttribute((rawUrl || "").trim())}">` +
    `<div class="vsserverapi-card" data-vsserverapi-card><div class="vsserverapi-loading" aria-live="polite">正在加载服务器信息…</div></div>` +
    `<div class="vsserverapi-content">${body || ""}</div></div>`
  );
}

async function loadCard(container) {
  const rawUrl = container.dataset.vsserverapiUrl;
  const apiUrl = normalizeApiUrl(rawUrl);
  if (!apiUrl) return showError(container, "服务器 API 地址无效，请使用 HTTP 或 HTTPS 地址。");
  try {
    const response = await fetch(apiUrl, { headers: { Accept: "application/json" }, credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("响应不是有效的 JSON 对象");
    renderCard(container, data, apiUrl);
  } catch (error) {
    showError(container, `无法加载服务器信息：${error.message || "请求失败"}。请确认 API 可访问并允许跨域请求。`);
  }
}

export default {
  name: "vsserverapi-cards",

  initialize() {
    withPluginApi("0.8.31", (api) => {
      api.decorateCookedElement((element) => {
        convertMarkdownMarkers(element);
        element.querySelectorAll(".vsserverapi-embed").forEach((container) => {
          if (!container.dataset.vsserverapiLoaded) {
            container.dataset.vsserverapiLoaded = "true";
            loadCard(container);
          }
        });
      }, { id: "vsserverapi-cards" });
    });
  }
};
