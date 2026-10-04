import { withPluginApi } from "discourse/lib/plugin-api";

const OPENING = /^\[vsserverapi(?:=([^\]\r\n]+))?\]\s*$/;
const CLOSING = /^\[vsserverapi\]\s*$/;

function escapeAttribute(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function vsServerApiBlock(state, startLine, endLine, silent) {
  const opening = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).match(OPENING);
  if (!opening) return false;

  let closingLine = startLine + 1;
  while (closingLine < endLine) {
    const line = state.src.slice(state.bMarks[closingLine] + state.tShift[closingLine], state.eMarks[closingLine]);
    if (CLOSING.test(line)) break;
    closingLine += 1;
  }

  if (closingLine >= endLine) return false;
  if (silent) return true;

  const token = state.push("vsserverapi", "div", 0);
  token.block = true;
  token.map = [startLine, closingLine + 1];
  token.attrSet("api-url", (opening[1] || "").trim());
  token.content = state.getLines(startLine + 1, closingLine, state.blkIndent, true);
  state.line = closingLine + 1;
  return true;
}

function renderVsServerApi(md, tokens, index, options, env) {
  const token = tokens[index];
  const rawUrl = token.attrGet("api-url") || "";
  const body = token.content ? md.render(token.content, env) : "";
  return `<div class="vsserverapi-embed" data-vsserverapi-url="${escapeAttribute(rawUrl)}">` +
    `<div class="vsserverapi-card" data-vsserverapi-card><div class="vsserverapi-loading" aria-live="polite">正在加载服务器信息…</div></div>` +
    `<div class="vsserverapi-content">${body}</div></div>`;
}

export default {
  name: "vsserverapi-markdown",

  initialize() {
    withPluginApi("0.8.31", (api) => {
      api.registerMarkdownItPlugin((md) => {
        md.block.ruler.before("fence", "vsserverapi", vsServerApiBlock, {
          alt: ["paragraph", "reference", "blockquote"]
        });
        md.renderer.rules.vsserverapi = (tokens, index, options, env) =>
          renderVsServerApi(md, tokens, index, options, env);
      });
    });
  }
};
