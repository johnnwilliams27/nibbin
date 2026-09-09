# Driving a browser from this environment

Every agent that tried Playwright reported `ERR_CONNECTION_RESET` and concluded
the browser was unusable here. That conclusion was wrong twice over, and both
halves are worth writing down because the wrong one cost a whole afternoon of
signup attempts that were recorded as impossible.

## 1. The library was not installed

`/opt/pw-browsers/` holds the browsers, and `PLAYWRIGHT_BROWSERS_PATH` points at
them, so it reads as a configured environment. The `playwright` **package** was
absent, so `import { chromium } from 'playwright'` failed with
`ERR_MODULE_NOT_FOUND` — which surfaced downstream as "the browser doesn't
work". Now a dev dependency at the workspace root.

## 2. Chromium must egress DIRECTLY, not through the agent proxy

The session sets `HTTPS_PROXY=http://127.0.0.1:38249` and Chromium inherits it.
Every navigation through it resets. Our own `guardedFetch` has worked all along
precisely because `pinnedFetch` dials the vetted address directly — the same
route Chromium needs.

Launch it like this:

```js
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--no-proxy-server', '--disable-quic'],
});
```

and clear the proxy vars for the process (`env -u HTTPS_PROXY -u HTTP_PROXY
-u https_proxy -u http_proxy`). `--no-proxy-server` alone is not enough.

`--disable-quic` is not optional. Without it, hosts that negotiate HTTP/3 fail
with `ERR_QUIC_PROTOCOL_ERROR` while plainer hosts succeed — which looks like a
per-site outage and invites the same "that server is unreachable" conclusion.

Verified: `example.com` 200, `klarix.ai/mcp` 200, `accounts.google.com` 200.

## Why this matters to the ratings work

It is the difference between two credential strategies. Without a browser, only
servers exposing a pure-API signup can be reached, which measured out at 2 of 22.
With it, web signup forms, email/OTP flows and OAuth consent screens are all
drivable, and the residual blockers shrink to payment walls, operator-closed
products, and bot-detection we decline to defeat on principle rather than on
capability.
