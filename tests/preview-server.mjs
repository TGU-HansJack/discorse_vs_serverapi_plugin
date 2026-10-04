import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "sass";

const root = new URL("../", import.meta.url);
const port = Number(process.env.PORT || 4179);
const css = compile(fileURLToPath(new URL("common/common.scss", root)), {
  loadPaths: [fileURLToPath(new URL("stylesheets", root))], silenceDeprecations: ["import"],
}).css;

function history() {
  const end = Math.floor(Date.now() / 3600000) * 3600000;
  return Array.from({ length: 168 }, (_, i) => ({
    timestampUtc: new Date(end - (167 - i) * 3600000).toISOString(),
    onlinePlayers: Math.max(0, Math.round(15 + 14 * Math.sin(i / 7))),
  })).filter((_, i) => i < 45 || i > 50);
}

const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VS Server API preview</title>
<link rel="stylesheet" href="/theme.css"><style>
:root { --primary:#222; --primary-medium:#666; --primary-low:#ddd; --primary-very-low:#f5f5f5; --secondary:#fff; --tertiary:#008c99; --tertiary-low:#cce8ee; --success:#24823f; --success-low:#e1f2e7; }
html.dark { --primary:#eee; --primary-medium:#aaa; --primary-low:#444; --primary-very-low:#292929; --secondary:#191919; --tertiary:#61c7d1; --tertiary-low:#24545c; --success:#7cce94; --success-low:#254a30; }
body { margin:0; background:var(--secondary); color:var(--primary); font:15px/1.5 system-ui,sans-serif; } main { max-width:820px; margin:24px auto; padding:0 12px; } .btn { border:0; background:transparent; color:var(--primary); cursor:pointer; } .btn:disabled { opacity:.35; cursor:default; } .d-icon { fill:currentColor; } .btn:hover:not(:disabled) { background:var(--primary-very-low); } button:focus-visible { outline:2px solid var(--tertiary); }
</style><svg aria-hidden="true" style="position:absolute;width:0;height:0"><defs>
<symbol id="plus" viewBox="0 0 448 512"><path d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32V224H48c-17.7 0-32 14.3-32 32s14.3 32 32 32H192V432c0 17.7 14.3 32 32 32s32-14.3 32-32V288H400c17.7 0 32-14.3 32-32s-14.3-32-32-32H256V80z"/></symbol>
<symbol id="minus" viewBox="0 0 448 512"><path d="M416 256c0 17.7-14.3 32-32 32H64c-17.7 0-32-14.3-32-32s14.3-32 32-32H384c17.7 0 32 14.3 32 32z"/></symbol>
<symbol id="rotate-left" viewBox="0 0 512 512"><path d="M48 160H192L144 112A176 176 0 1 1 80 304H32A224 224 0 1 0 112 80L48 16z"/></symbol>
<symbol id="chevron-down" viewBox="0 0 448 512"><path d="M224 352 32 160 64 128 224 288 384 128 416 160z"/></symbol>
<symbol id="chevron-up" viewBox="0 0 448 512"><path d="M224 128 32 320 64 352 224 192 384 352 416 320z"/></symbol>
</defs></svg><main id="cooked"></main><script type="module">
import initializer from '/javascripts/discourse/initializers/vsserverapi-cards.js';
const params = new URLSearchParams(location.search);
if (params.has('dark')) document.documentElement.classList.add('dark');
const api = params.has('live') ? 'http://127.0.0.1:8085/api' : location.origin + '/fixture/' + (params.get('mode') || 'normal') + '/api';
const marker = '[vsserverapi=' + api + ']\\n服务器公告\\n[vsserverapi]';
document.querySelector('#cooked').textContent = marker;
initializer.initialize();
window.addCard = () => { const node = document.createElement('article'); node.textContent = marker; document.querySelector('#cooked').append(node); window.decorate(node); };
</script></html>`;

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    let body;
    let type = "text/javascript";
    if (url.pathname === "/") { body = page; type = "text/html"; }
    else if (url.pathname === "/theme.css") { body = css; type = "text/css"; }
    else if (url.pathname === "/plugin-api.js") {
      body = `export function withPluginApi(_version, callback) { callback({ decorateCookedElement(fn) { window.decorate = fn; fn(document.querySelector('#cooked')); } }); }`;
    } else if (url.pathname.startsWith("/fixture/")) {
      const mode = url.pathname.split("/")[2];
      type = "application/json";
      if (url.pathname.endsWith("/players/history")) {
        if (mode === "error") { response.writeHead(503); response.end(); return; }
        body = JSON.stringify(history());
      } else {
        const data = { profileId: "hidden", serverName: "Vintage Story 测试服务器", version: "1.22.7", isRunning: true, onlinePlayers: 12, uptimeSeconds: 3600,
          mods: [{ name: "Carry On", url: "https://mods.vintagestory.at/carryon" }], playerCountHistoryHours: 168 };
        if (mode === "normal") data.hourlyPlayerCounts = history();
        if (mode === "empty") data.hourlyPlayerCounts = [];
        if (mode === "zero") data.hourlyPlayerCounts = history().slice(-1).map((row) => ({ ...row, onlinePlayers: 0 }));
        body = JSON.stringify(data);
      }
    } else if (/^\/javascripts\/[a-zA-Z0-9/.-]+$/.test(url.pathname) && !url.pathname.includes("..")) {
      const path = url.pathname.endsWith(".js") ? url.pathname.slice(1) : url.pathname.slice(1) + ".js";
      body = await readFile(new URL(path, root), "utf8");
      body = body.replace('"discourse/lib/plugin-api"', '"/plugin-api.js"');
    } else { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
    response.end(body);
  } catch (error) {
    response.writeHead(500);
    response.end(error.message);
  }
}).listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}`));
