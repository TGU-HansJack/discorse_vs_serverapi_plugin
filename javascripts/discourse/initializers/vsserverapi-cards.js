import { withPluginApi } from "discourse/lib/plugin-api";
import { historyMarkup, loadHistory } from "../lib/vsserverapi-history";

const DISPLAY_FIELDS = [
  ["version", "游戏版本"],
  ["isRunning", "运行状态"],
  ["worldName", "世界名称"],
  ["onlinePlayers", "在线玩家"],
  ["startedAtUtc", "启动时间"],
  ["uptimeSeconds", "运行时长"]
];

let modsSectionSequence = 0;

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

function formatServerStatus(value) {
  const labels = {
    running: "运行中",
    starting: "启动中",
    stopping: "停止中",
    stopped: "已停止",
    "shutting-down": "停止中"
  };
  const normalized = String(value ?? "").trim().toLowerCase();
  return labels[normalized] || formatValue(value);
}

function formatStartTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date);
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
  const known = new Set(DISPLAY_FIELDS.map(([key]) => key).concat(["profileId", "profileName", "serverName", "description", "coverUrl", "mods", "serverStatus", "address", "maxPlayers", "playerCountHistory", "playerCountHistoryMode", "playerCountHistoryHours"]));
  const rows = [];
  for (const [key, label] of DISPLAY_FIELDS) {
    if (!(key in data)) continue;
    let value = data[key];
    if (key === "isRunning") value = data[key] ? "运行中" : "已停止";
    if (key === "serverStatus") value = formatServerStatus(data[key]);
    if (key === "startedAtUtc") value = formatStartTime(data[key]) || formatValue(data[key]);
    if (key === "uptimeSeconds") value = formatDuration(data[key]) || formatValue(data[key]);
    rows.push(`<div class="vsserverapi-field"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatValue(value))}</dd></div>`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (known.has(key)) continue;
    rows.push(`<div class="vsserverapi-field"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatValue(value))}</dd></div>`);
  }
  return rows.join("");
}

function modValue(mod, keys) {
  for (const key of keys) {
    const value = mod?.[key];
    if (Array.isArray(value) && value.length) return value.filter(Boolean).join(", ");
    if (value !== null && value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

function modInitials(name) {
  return name.trim().slice(0, 2).toUpperCase();
}

function downloadIcon() {
  return `<svg class="fa d-icon d-icon-download svg-icon" width="1em" height="1em" aria-hidden="true"><use href="#download"></use></svg>`;
}

function renderMods(mods, apiUrl) {
  if (!Array.isArray(mods)) return "";
  const cards = mods.map((mod) => {
    const name = modValue(mod, ["name", "modName", "modId"]);
    if (!name) return "";
    const version = modValue(mod, ["version", "modVersion", "latestVersion"]);
    const author = modValue(mod, ["author", "authors", "creator", "owner"]);
    const description = modValue(mod, ["description", "summary", "modDescription"]) || "暂无介绍";
    const cover = resolveAssetUrl(modValue(mod, ["coverUrl", "cover", "imageUrl", "iconUrl", "logoUrl", "thumbnailUrl"]), apiUrl);
    const url = resolveAssetUrl(modValue(mod, ["latestDownloadUrl", "downloadUrl", "url", "website"]), apiUrl);
    const versionText = version ? (version.toLowerCase().startsWith("v") ? version : `v${version}`) : "";
    const downloadLabel = `下载 ${name} 的最新版本`;
    const coverMarkup = cover
      ? `<img class="vsserverapi-mod-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" data-mod-initials="${escapeAttribute(modInitials(name))}">`
      : `<div class="vsserverapi-mod-cover vsserverapi-mod-cover-placeholder" aria-hidden="true">${escapeHtml(modInitials(name))}</div>`;
    const download = url
      ? `<a class="btn no-text btn-flat vsserverapi-mod-download" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttribute(downloadLabel)}" title="${escapeAttribute(downloadLabel)}">${downloadIcon()}</a>`
      : `<button type="button" class="btn no-text btn-flat vsserverapi-mod-download" aria-label="${escapeAttribute(downloadLabel)}" title="${escapeAttribute(downloadLabel)}" disabled>${downloadIcon()}</button>`;
    return `<article class="vsserverapi-mod-card">${coverMarkup}<div class="vsserverapi-mod-copy"><div class="vsserverapi-mod-meta"><strong>${escapeHtml(name)}</strong>${versionText ? `<span>${escapeHtml(versionText)}</span>` : ""}${author ? `<span>${escapeHtml(author)}</span>` : ""}</div><p>${escapeHtml(description)}</p></div>${download}</article>`;
  }).filter(Boolean).join("");
  return `<section class="vsserverapi-mods"><h4>模组列表</h4><div class="vsserverapi-mod-list">${cards || "<span class=\"vsserverapi-empty\">暂无模组</span>"}</div></section>`;
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
  const detailsId = `vsserverapi-details-${++modsSectionSequence}`;
  const detailsToggle = `<button type="button" class="btn no-text btn-flat vsserverapi-mod-toggle" aria-controls="${detailsId}" aria-expanded="false" aria-label="展开图表和模组列表" title="展开图表和模组列表"><svg class="fa d-icon d-icon-chevron-down svg-icon fa-width-auto" width="1em" height="1em" aria-hidden="true"><use href="#chevron-down"></use></svg></button>`;
  card.innerHTML = `<div class="vsserverapi-main">` +
    `<div class="vsserverapi-cover-wrap">${cover ? `<img class="vsserverapi-cover" src="${escapeHtml(cover)}" alt="" loading="lazy">` : `<div class="vsserverapi-cover-placeholder" aria-hidden="true">VS</div>`}</div>` +
    `<div class="vsserverapi-summary"><div class="vsserverapi-title-row"><h3>${escapeHtml(title)}</h3><span class="vsserverapi-status ${statusClass}">${statusText}</span>${detailsToggle}</div>${description}<dl class="vsserverapi-fields">${renderInfo(data)}</dl></div></div>` +
    `<div class="vsserverapi-details" id="${detailsId}" hidden>${historyMarkup()}${renderMods(data.mods, apiUrl)}</div>`;
  loadHistory(card.querySelector(".vsserverapi-history"), data, apiUrl);
  const toggle = card.querySelector(".vsserverapi-mod-toggle");
  const detailsSection = card.querySelector(`#${detailsId}`);
  if (toggle && detailsSection) {
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      toggle.setAttribute("aria-label", `${expanded ? "展开" : "收起"}图表和模组列表`);
      toggle.setAttribute("title", `${expanded ? "展开" : "收起"}图表和模组列表`);
      detailsSection.hidden = expanded;
      const icon = toggle.querySelector("use");
      if (icon) icon.setAttribute("href", expanded ? "#chevron-down" : "#chevron-up");
    });
  }
  const image = card.querySelector("img");
  if (image) image.addEventListener("error", () => image.replaceWith(Object.assign(document.createElement("div"), { className: "vsserverapi-cover-placeholder", textContent: "VS" })), { once: true });
  card.querySelectorAll("img.vsserverapi-mod-cover").forEach((cover) => {
    cover.addEventListener("error", () => cover.replaceWith(Object.assign(document.createElement("div"), {
      className: "vsserverapi-mod-cover vsserverapi-mod-cover-placeholder", textContent: cover.dataset.modInitials
    })), { once: true });
  });
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
  element.innerHTML = element.innerHTML.replace(marker, (_match, rawUrl, body) => {
    const content = String(body || "").replace(/^\s*(?:<br\s*\/?>\s*)+|(?:<br\s*\/?>\s*)+\s*$/gi, "").trim();
    return `<div class="vsserverapi-embed" data-vsserverapi-url="${escapeAttribute((rawUrl || "").trim())}">` +
    `<div class="vsserverapi-card" data-vsserverapi-card><div class="vsserverapi-loading" aria-live="polite">正在加载服务器信息…</div></div>` +
    (content ? `<div class="vsserverapi-content">${content}</div>` : "") +
    `</div>`;
  });
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
