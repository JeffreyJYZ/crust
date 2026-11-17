# Window and UI plugins

Area: `src/plugins/` — `window*`, `dialog`, `menu*`, `findinpage`, `navigation*`, `i18n*`, `positioner`, `deep-link`, `single-instance` (implementations plus their tests).

## Findings

### 1. A closed window becomes `unknown-window` on macOS; `isOpen` can never answer `false` — HIGH
`src/plugins/window-args.ts:150`

`knownWindow` decides a label's existence with `native.list().includes(label)`. The real adapter's `list()` is `platform.windowLabels()` (`src/platform/darwin/window-adapter.ts:97`), and `WindowRegistry.labels()` filters closed windows out (`src/platform/darwin/windows.ts:77-79`). So the moment `window.close` returns, the plugin's shared `act` gate (`src/plugins/window.ts:59-62`) refuses every later command on that label with `unknown-window`.

The adapter already has the right answer: `darwinWindowAdapter.isOpen` (`src/platform/darwin/window-adapter.ts:101-109`) reads `windowNumber`, which `WindowRegistry.number` returns `0` for a closed-but-tracked window (`src/platform/darwin/windows.ts:112-113`) — but the gate makes that code unreachable. The same gate in `src/plugins/window-persist.ts:105` breaks `window-state.save` on a just-closed window.

**Breaks:** `window.isOpen({label})` answers `unknown-window` instead of `{open:false}` after close; a second `window.close()` errors instead of the promised idempotent success. This is exactly the `window-all-closed` signal `src/plugins/window.test.ts:74-95` was written to protect.

**Evidence:** `return native.list().includes(label) ? undefined : unknownWindow(label);` — `src/plugins/window-args.ts:151`. The tests pass only because `fakeAdapter.list()` returns `[...windows.keys()]`, including closed ones (`src/plugins/window-fake.ts:92`); `window.test.ts:59-66` asserts "closed is not unknown", which the real platform does not do.

### 2. Two processes can both win a stale single-instance lock — MEDIUM
`src/plugins/single-instance.ts:134`

After reading a dead pid, `acquire` calls `drop(path)` unconditionally, without re-checking that the file still names that dead pid. Two waiters interleave: both read the dead pid, A drops and re-takes the lock (writing its own pid), B then drops A's fresh lock and re-takes it. Both return `acquired: true`. The two-attempt loop does not prevent this — it re-tests `take`, but the intervening `drop` is what destroys the winner's lock.

**Breaks:** two copies of an app both believe they are the single instance after a crash left a stale lock; the "second" instance is never raised into the first.

**Evidence:** `drop(path);` at line 140, reached from `if (holder !== undefined && isAlive(holder)) return ...` at line 139 with no compare-and-delete. The comment at line 134 claims two attempts stop two waiters from both unlinking, but no state is revalidated before the unlink.

### 3. A `__proto__` window label silently loses its saved frame and corrupts restore — MEDIUM
`src/plugins/window-persist-store.ts:52`

`readState` and `writeState`'s caller both build a plain `{}` and assign `state[label] = frame`. For the label `"__proto__"` that invokes the inherited setter instead of creating an own property, so the frame is never serialised. `save` still returns `{ok:true, frame}`. On the next `readState`, `state["__proto__"]` is `Object.prototype` (not `undefined`), so `restore` passes a non-frame to `calls.apply` with `frame.width`/`frame.height` undefined.

**Breaks:** a window whose label is `__proto__` can be created (`readLabel` accepts any non-empty string) but never restores its saved position, and `save` reports a frame it did not write.

**Evidence:** `const state: Record<string, WindowFrame> = {};` then `state[label] = frame;` — `src/plugins/window-persist-store.ts:52-55`; same assignment at `src/plugins/window-persist.ts:150`. Probed: `writeState(f, {__proto__: frame, main: frame})` produced a JSON file containing only `main`, and `readState(f)["__proto__"]` was `object`.

### 4. A protocol-relative `window.create` URL escapes "own document" handling — MEDIUM
`src/plugins/window-create.ts:48`

`own` is decided only by a URI-scheme regex. A network-path reference such as `"//evil.example/x"` has no scheme, so it is treated as the app's own document: the plugin appends `?window=<label>` to it, and the darwin adapter resolves it with `new URL(url, documentBase())` into `http://evil.example/x?window=<label>`. The documented contract says only relative URLs get a label appended and absolute URLs are handed through untouched; this URL is effectively absolute but takes the relative path.

**Breaks:** a page can open a window on a foreign origin with the app's injected window identity, and the "own document" branch the plugin reserved for app pages is applied to a URL the app never composed.

**Evidence:** `const own = url === undefined || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);` — `src/plugins/window-create.ts:48`; `new URL(url ?? "/", documentBase()).toString()` — `src/platform/darwin/window-adapter.ts:48`. Probed: `//evil.example/x` → `own=true` → `//evil.example/x?window=foo` → `http://evil.example/x?window=foo`.

### 5. Menu test comment claims three commands while asserting five — LOW
`src/plugins/menu.test.ts:61`

`describe("menu plugin shape", ...)` is preceded by `test("is named menu, declares three commands and is frozen")`, but the assertion checks `["isDefault", "read", "reset", "setAppMenu", "showContext"]` — five. A docstring that does not match what the code asserts.

**Breaks:** nothing at runtime; misleading review surface.

**Evidence:** `test("is named menu, declares three commands and is frozen", () => {` — `src/plugins/menu.test.ts:61`; `expect(names).toEqual(["isDefault", "read", "reset", "setAppMenu", "showContext"]);` — line 65.

## Coverage

Read every implementation and test file in my area: `window.ts`, `window-args.ts`, `window-create.ts`, `window-types.ts`, `window-state*.ts`, `window-chrome*.ts`, `window-persist*.ts`, `window-fake.ts`, `window-label.ts`, `dialog.ts`, `menu.ts`/`menu-spec.ts`/`menu-read.ts`, `findinpage.ts`, `navigation.ts`/`navigation-target.ts`/`navigation-types.ts`/`navigation-fake.ts`, `i18n*.ts`, `positioner.ts`, `deep-link.ts`, `single-instance.ts`, `define.ts`, `registry.ts`, `index.ts` barrels, and their suites. Read supporting contract code outside the area only to confirm the real adapter path: `src/platform/darwin/{window-adapter,windows,window-create,liveness}.ts`, `src/bridge/server.ts`, `src/bridge/server/invoke.ts`, `src/runtime-plugins.ts`.

Specifically checked and found no defect: `i18n` does **not** silently return the key — `messageFor` throws a `bad-request` for a missing key and every placeholder; `interpolate` refuses missing vars. The `menu`/`navigation` `sink` is not window-stale in the per-request sense because the bridge hands every handler the same app-wide `emit` (`src/bridge/server.ts:48-49`); a selection after a window closes still broadcasts app-wide by design. No dialog callback survives a close — `dialog` holds no emitted context at all. No navigation origin allowlist exists in `src/plugins`; the origin gate lives in `src/bridge/server/cors.ts`, outside my area.

Not examined: the platform-specific `darwinMenuAdapter`/`darwinFindAdapter`/`darwinLocale` internals beyond the window path, and the docs site. Next thing I would look at: whether any caller relies on `window.list()` including closed windows (if so finding 1 needs a compatibility decision), and a concurrent stress test for `single-instance.acquire` around a stale lock.
