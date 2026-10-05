# Discourse VS Server API

This Discourse component renders a LauncherGo server card from a server API URL.

Use it in a topic post like this:

```text
[vsserverapi=http://127.0.0.1:8085/api]
这里是卡片下方的 Markdown 内容。
[vsserverapi]
```

The component detects the marker after Discourse renders a post. The API response is fetched by the browser. The endpoint must return JSON and allow CORS from the Discourse origin. URLs without a scheme are treated as `http://`; HTTPS pages cannot fetch an HTTP endpoint because of browser mixed-content rules.

The player chart shows the last 2,016 five-minute slots (seven days), using LauncherGo's `playerCountHistory` from the server response. If that field is absent, it supports the older `hourlyPlayerCounts` field or fetches `/api/players/history` (also supporting `/api/server` URLs, proxy path prefixes and query parameters). Each record contains `timestampUtc` and an integer `onlinePlayers`. Missing samples remain gaps, actual zero counts stay zero, and timestamps are displayed in the reader's local timezone. An empty or failed history response does not affect the server summary or mod list.

The chart and mod list share the card's top-right disclosure button and are collapsed by default. The line has no dot at every sample. A dashed red line marks the seven-day maximum. Each local calendar day's best three-to-five-hour window is highlighted as a translucent green band; the duration may use any five-minute increment in that range, a window may cross a local day boundary, windows with an average below two players are omitted, windows may contain missing samples as long as no missing run exceeds three samples, and averages use the available samples. Use the plus/minus controls or drag across the plot to zoom the time axis (6 hours to 7 days); reset restores the full week. When zoomed, use the horizontal scrollbar, horizontal trackpad scrolling, Shift+wheel, or a horizontal swipe on the plot to move through the week. Hovering the plot snaps the vertical cursor to a sample interval and shows that sample's timestamp and player count centered above the cursor. History is a snapshot loaded with the post, not a live polling feed.

The component bundles [uPlot 1.6.32](https://github.com/leeoniya/uPlot), under the [MIT license](licenses/uplot-LICENSE), as an ES module and scoped stylesheet. No external chart CDN is needed at runtime.

For local verification, run `npm ci`, `npx playwright install chromium`, and `npm test`. `npm run preview` serves a standalone fixture at `http://127.0.0.1:4179`; add `?live=1` to read the local LauncherGo API at port 8085. Set `PORT` to use another port. This preview stubs the Discourse decorator API; a final check inside Discourse is still needed after installing the updated theme component.
