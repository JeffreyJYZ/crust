# multi-window

Two windows from config, a third created at runtime, one page served to all of
them. It exists because nothing else in the repo demonstrates more than one
window, and the multi-window path had a real bug: the webview resolver was built
from `windowLabels()[0]`, so navigation, find-in-page and downloads all acted on
the first window silently.

Run it, watch the `inspector` window jump to 100,120 and 420×300 while the
command runs in `main`, and read the lines on stdout.

## Run it

From the crust checkout:

```sh
bun run src/cli/index.ts dev --dir examples/multi-window
```

A project that installed crust writes the same thing as `bunx crust dev`.

## Build it

```sh
bun run src/cli/index.ts build --dir examples/multi-window
./examples/multi-window/dist/Multi-window.app/Contents/MacOS/crust-app
```

Launch the binary directly, not with `open`: `open` routes through LaunchServices
and raises Gatekeeper dialogs on an ad-hoc signed bundle.

## The lines, and what each one proves

```
multi-window: two windows from config, one page in both
labels main,inspector
opened scout
inspector frame 100,120,420,300
closed inspector, labels main,scout
closed scout, labels main
multi-window: PASS 5/5
```

- **`labels main,inspector`** — `window.list` answered with both configured
  labels. A second window really exists, in the platform's own registry, before
  anything is created.
- **`opened scout`** — `window.create` built a third `NSWindow` at runtime. Its
  page loads `/?window=scout`, so it also knows its own label.
- **`inspector frame 100,120,420,300`** — the driver runs in `main` and names
  `inspector`. The numbers are `getPosition` + `getSize` read back _after_ the
  write, never the values the page asked for: an action that landed on the first
  window prints `main`'s frame instead. This is the regression guard.
- **`closed inspector, labels main,scout`** — the close reached `inspector`, and
  the list read back afterwards no longer contains it.
- **`closed scout, labels main`** — the runtime-created window is gone too, so
  the app is back to what config opened.
- **`PASS 5/5`** — the backend counts the lines and fails the verdict on any
  `failed …` line, so a step that throws cannot look like a short run that
  finished.

The header is always the first line: the page drives only after the backend
answers `ready`, which it answers only once `app.run()` has resolved.

## What is where

```
crust.config.ts      two windows, different sizes and titles
main.ts              the page's channel: prints one line per step, then the verdict
public/index.html    the document every window loads
public/app.js        identity, the resize button, and the driver in `main`
```

The page reads its own label from `?window=`, which each config entry puts in its
URL, and the resize button names that label explicitly, so clicking it in
`inspector` resizes `inspector`.

## Gaps this example could not close

- **No `window.label` command.** A page cannot ask which window it is. The
  identity here comes from the URL the config opened, not from the platform, so a
  window created with no `url` has no way to learn its own label.
- **The backend cannot issue a window command.** `crust:window` is page-facing,
  and the running `Platform` is private to `startApp` — `app` has no accessor for
  it, so `main.ts` cannot list, move or close a window itself. The steps are
  driven from the page and the backend prints what the platform answered.
- **Navigation, find-in-page and downloads take no label from the page.** Their
  darwin adapters accept one (`LabeledAdapter`), but the plugins never forward it,
  so a page still cannot aim those three at another window. That is exactly the
  surface the resolver bug touched, and it is unexercised from the page today.
