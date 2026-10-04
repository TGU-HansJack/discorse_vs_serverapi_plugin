# Discourse VS Server API

This Discourse component renders a LauncherGo server card from a server API URL.

Use it in a topic post like this:

```text
[vsserverapi=http://127.0.0.1:8085/api]
这里是卡片下方的 Markdown 内容。
[vsserverapi]
```

The component detects the marker after Discourse renders a post. The API response is fetched by the browser. The endpoint must return JSON and allow CORS from the Discourse origin. URLs without a scheme are treated as `http://`; HTTPS pages cannot fetch an HTTP endpoint because of browser mixed-content rules.

The player chart shows the last 168 hourly slots, using `hourlyPlayerCounts` from the server response. If that field is absent, it fetches `/api/players/history` (also supporting `/api/server` URLs, proxy path prefixes and query parameters). Each record contains `timestampUtc` and an integer `onlinePlayers`. Missing hours remain gaps, actual zero counts stay zero, and timestamps are displayed in the reader's local timezone. An empty or failed history response does not affect the server summary or mod list.

Use the plus/minus controls or drag across the plot to zoom the time axis (6 hours to 7 days); reset restores the full week. When zoomed, use the horizontal scrollbar, horizontal trackpad scrolling, Shift+wheel, or a horizontal swipe on the plot to move through the week. The focused scrollbar also supports Left/Right and Home/End. Hovering a point shows its timestamp and player count. History is a snapshot loaded with the post, not a live polling feed. Mods remain collapsed by default.

The component bundles [uPlot 1.6.32](https://github.com/leeoniya/uPlot), under the [MIT license](licenses/uplot-LICENSE), as an ES module and scoped stylesheet. No external chart CDN is needed at runtime.

For local verification, run `npm ci`, `npx playwright install chromium`, and `npm test`. `npm run preview` serves a standalone fixture at `http://127.0.0.1:4179`; add `?live=1` to read the local LauncherGo API at port 8085. Set `PORT` to use another port. This preview stubs the Discourse decorator API; a final check inside Discourse is still needed after installing the updated theme component.
