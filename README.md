# Discourse VS Server API

This Discourse component renders a LauncherGo server card from a server API URL.

Use it in a topic post like this:

```text
[vsserverapi=http://127.0.0.1:8085/api]
这里是卡片下方的 Markdown 内容。
[vsserverapi]
```

The component detects the marker after Discourse renders a post. The API response is fetched by the browser. The endpoint must return JSON and allow CORS from the Discourse origin. URLs without a scheme are treated as `http://`; HTTPS pages cannot fetch an HTTP endpoint because of browser mixed-content rules.
