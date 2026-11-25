# Lane M companion — the AppKit-only floor

This is the detail behind `10-startup.md`. All 84 samples were contaminated (one-minute load
3.84–5.87, 26–38 `bun` processes); arms were interleaved six rounds. Every probe was ≤ 20 s, ran
through `probe-run`, and used a background window with the private occlusion override. No OS
screenshot, no focus theft.

## The probe

`scripts/perf/startup-bare.{ts,c,arms.ts}` is AppKit only: `NSApplicationLoad`, `sharedApplication`,
one `NSWindow initWithContentRect:`, one `WKWebView initWithFrame:configuration:` with a stock
configuration, `loadHTMLString` of a page whose first `requestAnimationFrame` sets `document.title`,
then a 5 ms `NSRunLoop` drain per poll. No crust runtime, bridge, content world, injected script,
scheme handler or config file. First paint is the page's own rAF; the harness reports the delta from
process start the same way the crust arm does. `orderFront:` replaces the requested
`makeKeyAndOrderFront:` so the probe cannot take focus; the activation-policy row sets crust's value
but never calls `activateIgnoringOtherApps:`.

## Floor, stacked

Median `bare-inline` sample (`bare-inline-3`, rows sum exactly):

| Segment | ms |
|---|---:|
| process start → first line | 9 |
| conditions snapshot (harness) | 20 |
| native `cc` compile (harness) | 12 |
| `NSApplication` + window + webview | 112 |
| `loadHTMLString` including WebKit service start | **243** |
| document parse → first rAF | 172 |
| **TOTAL** | **568** |

Corrected for its own harness rows, the floor is 536 ms p50.

## Cumulative arms, p50/p95 and delta over the floor

| Arm (cumulative flags) | n | p50 | p95 | Δ vs floor |
|---|---:|---:|---:|---:|
| `bare-inline` — floor | 6 | 568 | 596 | — |
| `bare-activation` (16) | 6 | 536 | 617 | −32 |
| `bare-config` (16, same flags — control) | 6 | 557 | 593 | −11 |
| `bare-scripts` (18, 7,230 script bytes) | 6 | 644 | 1392 | +76 |
| `bare-scheme` (26) | 6 | 555 | 596 | −13 |
| `bare-pool` (27) | 6 | 575 | 709 | +7 |
| `bare-bridge` (bind before create) | 6 | 553 | 623 | −15 |
| `bare-http` (bridge + HTTP document) | 6 | 577 | 716 | +9 |
| `bare-http-control` (bridge + inline document) | 6 | 549 | 623 | −19 |
| `bare-deferred` (bridge after first paint) | 6 | 551 | 614 | −17 |
| `bare-deferred-load` (bridge after create, before load) | 6 | 560 | 981 | −8 |
| `bare-no-bridge` (HTTP document, no server) | 6 | 4393 | 4395 | never painted |

Flags are cumulative: 1 fresh `WKProcessPool`, 2 injected content-world scripts, 4 a config flag,
8 a registered `crust-net` scheme handler, 16 crust's regular activation policy. Crust's real
`WKWebViewConfiguration` has no extra flags beyond stock, which is why `bare-config` repeats
`bare-activation` as a same-flag control.

The control row spreads 21 ms. Every delta except the scripts arm sits inside that spread, and the
scripts arm's median is inflated by one 1392 ms run at load 4.10; its five other runs are 558–685 ms.
There is no crust-specific cost in the 318 ms create row: the bare floor's native window (112 ms)
plus `loadHTMLString`/WebKit service start (243 ms) is already the same order. The 7,230 injected
bytes are measurable only as a noisy +76 ms, not as a stable parse charge.

## Navigation and deferral

**Navigation, 192 ms.** `bare-http` 577 vs `bare-http-control` 549 = **+28 ms** for a real loopback
document route over an inline string, inside the control spread. In the bare floor the
`loadHTMLString` call itself costs 243 ms and the wait for first rAF another 172 ms. Most of the
crust harness's 192 ms is WebKit document/rAF work, not the HTTP round trip; serving the initial
document inline would cut at most ~28 ms.

**Bridge deferral.** `bare-deferred-load` (bridge bound after window creation, before the document
request) is 560 ms, 8 ms below the floor and inside noise; the bridge bind row itself is 1 ms.
`bare-deferred` (bridge after first paint) is 551 ms, also inside noise, but `bare-no-bridge` never
painted at all in 4 s: the document route refuses a request without a token from the bridge. A page
that has not loaded cannot invoke, but it must be *served*, so the bridge is on the document path.
Deferring it in `src/app.ts` would buy no measurable time and could leave a blank window. Left alone.

## Reproduce

```
cd ~/dev/worktrees/crust/perf-startup
arms=(bare-inline bare-activation bare-config bare-scripts bare-scheme bare-pool bare-bridge bare-http bare-http-control bare-no-bridge bare-deferred bare-deferred-load)
for i in 1 2 3 4 5 6; do for arm in "${arms[@]}"; do
  probe-run -c "timeout 20 bun scripts/perf/startup-bare.ts measure --arm $arm --label $arm-$i"
done; done
```
