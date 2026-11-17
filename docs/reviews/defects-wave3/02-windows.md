# Windows platform driver, shim and tests

## Findings

### 1. The frame scanner silently skips every local array whose declarator is not one bare word — HIGH
`src/platform/windows/frames.ts:94` (with `:97`, `:101-103`)

`declaration()` bails with `undefined` on anything the regex does not match, and `localArrays()` cannot
tell "not a declaration" from "a declaration I could not parse" — so the array is dropped before
`offences()` can apply its own "unmeasurable is a failure" rule. Four shapes ≥ 4096 bytes therefore
compile straight past `frame.test.ts`, each of them the exact `__chkstk` trap the module exists to
prevent:

- a pointer element (`void *p[512]`, 4096 bytes, or `char *p[4096]`) — `([A-Za-z_][\w *]*?)\s+` cannot
  end before `*buf`, and `POINTER` at line 101 is only reachable for a type the regex already accepted;
- a second dimension (`shim_wchar buf[64][64]`, 8192 bytes) — the bound class `[^[\]]+?` refuses `[`;
- an initialiser (`unsigned char buf[4096] = {0}`) — the text no longer ends in `]`;
- two declarators in one statement (`shim_wchar a[1024], b[1024];`).

Measured by driving the exported functions directly:

```
void *p[512]              => []
shim_wchar *p[2048]       => []
char *p[4096]             => []
const shim_wchar *p[2048] => []
shim_wchar buf[64][64]    => []
unsigned char buf[4096] = {0} => []
shim_wchar a[1024], b[1024];  => []
shim_u64 a[512]           => [{"bytes":4096}]   // the shape the suite tests
```

**Breaks:** a future 4 KiB frame lands in `call __chkstk`, nothing defines it, and the unit dies at
its own first instruction with `0xFFFFFFFFFFFFFFFF` — the failure the module was written after, with a
green gate behind it.

**Evidence:** `if (!shape) return undefined;` … `const bytes = elements === undefined || size === undefined ? undefined : elements * size;`
— `offences()` only ever sees entries that reached line 104.

### 2. A failed `createWindow` leaks the shim's window slot and its controller, and after eight it bricks window creation — MEDIUM
`src/platform/windows/window-open.ts:37-38`, `src/platform/windows/shim/42_webview.c:57-74`, `:9`

`shim_webview_new` returns `shim_webview_navigate(url)` as its whole result, so a `Navigate` failure
arrives after `shim_webview_bind` has already written `g_hwnd[i]` / `g_ctrl[i]` and AddRef'd the
controller. The error path then calls only `shim_window_destroy` — never `shim_webview_close`, which
is the one function that clears those slots. `g_windows` is never decremented, so every retry appends
another dead entry; at `g_windows >= SHIM_MAX_WINDOWS` (8) `shim_webview_bind` returns 0 forever and
**every later `createWindow` in the process throws** `"WebView2 controller failed"`, naming a slot
refusal that never happened.

**Breaks:** an app that retries a window whose first navigation failed (a bridge not up yet, a page
that refuses) works a handful of times and then can never open a window again until it is restarted;
the leaked controller and its browser instance are never closed.

**Evidence:** `if (g_windows >= SHIM_MAX_WINDOWS) return 0;` … `g_ctrl[i] = ctrl;` … and in the
TypeScript: `shim.shim_window_destroy(hwnd);` with no `shim_webview_close`.

### 3. The preflight that names every unresolved entry point is never run, and the table it uses is incomplete — MEDIUM
`src/platform/windows/preflight.ts:51-56`, `:78-96`, `src/platform/windows/backend-default.ts:36-42`

`WindowsRuntimeReport.missing` is declared and read (`preflight.ts:89`) but no production code ever
sets it: `defaultBackend().probe()` returns `buildNumber`, `loader` and `coreVersion` only. So the
whole `"N entry point(s) did not resolve"` branch is unreachable, `PREFLIGHT`'s 21 entries — each with
a hand-written `breaks` string — are consumed only by `imports.test.ts` (module names) and
`preflight.test.ts`, and what a user actually gets on a broken machine is the single generic sentence
in `platform.ts:75`. That is the opposite of the file's own claim:

> `/** Every entry point the shim calls, checked before a window is attempted. */`

And the list is short: `VirtualQuery` and `GetTickCount64` are bound in `12_win32.c` and absent from
`PREFLIGHT`. `preflight.test.ts:64` cannot catch that, because "covers every entry point the shim
calls" asserts 10 hard-coded names rather than deriving the set from the shim, so its comment
(`:63`) is a claim the test does not keep.

**Breaks:** a machine missing one export gets `"user32, ole32 or kernel32 is missing an export this
shim calls"` with no symbol named, and the diagnostic table written for exactly that case is never
printed.

**Evidence:** `probe(): WindowsRuntimeReport { return { buildNumber: release(), loader: hasLoader(), coreVersion: coreVersion() }; }`

### 4. `WM_SIZE` reads an uninitialised `RECT` when `GetClientRect` fails — LOW
`src/platform/windows/shim/20_class.c:23-28`

`GetClientRect`'s return is ignored, then `rect[2] - rect[0]` and `rect[3] - rect[1]` are handed to
`shim_webview_put_bounds`. `shim_window_client_num` checks the same call four lines of C away; the
window procedure does not. A failed call leaves all four ints indeterminate and the controller is
resized to a garbage rectangle.

**Breaks:** reachable only for a window whose client rect cannot be read during a size message, so
in practice never; when it does happen the page is laid out to an arbitrary size rather than the
failure being visible.

**Evidence:** `int rect[4];\n\tGetClientRect(hwnd, rect);\n\tshim_webview_put_bounds(hwnd, (double)(rect[2] - rect[0]), …)`

### 5. `WindowsPlatformConfig.userDataDir` cannot be set by any caller — LOW
`src/platform/windows/platform-config.ts:14`, `src/platform/windows/platform.ts:32`, `src/app-loop.ts:74`

`loadPlatform` builds the Windows config as `{ ...config, appName: config.app.name }` and `CrustConfig`
has no `userDataDir` key, so `config.userDataDir ?? ""` is always `""` and WebView2 always picks its
own profile directory. The one documented knob for isolating a second instance is dead.

**Breaks:** two crust apps built from the same executable name share one WebView2 user-data folder, so
profile state and cookies cross between them.

**Evidence:** `windows.createPlatform({ ...config, appName: config.app.name });` — no `userDataDir`.

## Coverage

Read in full: `ffi.ts`, `frames.ts`, `shim-source.ts`, `backend.ts`, `backend-default.ts`,
`platform.ts`, `platform-config.ts`, `window-open.ts`, `windows-registry.ts`, `teardown.ts`,
`preflight.ts`, `cstring.ts`, `index.ts`, `fake-backend.ts`, `fake-shim.ts`, all ten
`shim/*.c` parts, and every `*.test.ts` in the directory (16 files).

Checked against real declarations rather than from memory:

- **bun:ffi arity and width** — all 60 symbols in the `cc()` map walked one by one against the C
  definition. Arity and return width agree everywhere; no 32-bit `HRESULT`/`BOOL` is declared wide and
  no pointer is narrowed. `shim_handler_vtbl_addr` / `_entry` / `_object_addr` / `_first_field` return
  `shim_i64` in C and are declared `P`, which is the same 64-bit slot and reads the same value — noted,
  not counted as a defect. `shim_thread_at`/`shim_thread_id` are `u32` on both sides.
- **Vtable slots** — downloaded the real `WebView2.h` (NuGet `Microsoft.Web.WebView2` 1.0.2903.40) and
  read `ICoreWebView2Vtbl`, `ICoreWebView2ControllerVtbl` and `ICoreWebView2EnvironmentVtbl` in
  declaration order: `get_Source` 4 / `Navigate` 5 / `NavigateToString` 6, `put_IsVisible` 4 /
  `put_Bounds` 6 / `Close` 24 / `get_CoreWebView2` 25, `CreateCoreWebView2Controller` 3. The table and
  `slots.test.ts` are correct, and `slot 37 = get_BrowserProcessId` checks out too. The `Invoke`
  signature is `(HRESULT, ICoreWebView2Controller*)` — a direct pointer, matching `void *created` —
  and `CreateCoreWebView2EnvironmentWithOptions` takes four parameters, matching the typedef.
- **AddRef/Release on out-parameters** — the borrowed out-parameter is AddRef'd through the guarded
  slot before it is stored (`handler_invoke` → `handler_addref_object`), and `get_CoreWebView2`'s
  reference is deliberately kept. Both handler objects are statics, so a completion handler cannot
  outlive its frame.
- **`VirtualQuery`** — the `!= sizeof info` guard reads as a region-size check but Microsoft's
  "actual number of bytes returned in the information buffer" makes it correct at 48 bytes; the
  `State`/`Protect` offsets (32/36) and the 48-byte `MEMORY_BASIC_INFORMATION` layout agree.
- Frame size — 11 local arrays, largest 2048 bytes (`shim_wchar dir[1024]`), none at the limit; the
  `static` buffers (`g_url[2048]`, `g_handler_vtbl[8]`) are correctly skipped.

Not read: `scripts/windows/{stages,report,composite}.ts` (the probe, another area) except where
`attach.test.ts` / `composite.test.ts` quote them. No file in this area exceeds the 200-line cap
(largest 187). I ran no build, no suite and no formatter, and changed nothing outside this report.