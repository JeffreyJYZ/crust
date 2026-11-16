# Windows platform lane — measured facts, traps, decisions

Written 2026-11-16 by the lane that built `src/platform/windows/`. Nothing here ran on Windows: the machine is macOS, so every bullet marked _decision_ is a reading of the WebView2 docs and the darwin precedent, not a measurement, and every bullet marked _trap_ is a trap found by static reasoning or by clang.

## Status

- **The whole layer is unproven on Win32** — no Windows machine was available, so no `user32`, `ole32` or WebView2 call in this tree has ever executed; treat the first Windows run as the real test.
- **Gates that did run and pass**: `bun test src/platform/windows` (44 pass across 5 files), `bun run check:lines` (PASS), `bun run scripts/windows-smoke.ts` (refuses with `unavailable: … needs Windows; running darwin/arm64`, exit 1, which is correct), and `clang -fsyntax-only -std=c99 -Wall` over the assembled C unit with zero diagnostics.
- **The first real Win32 run happened in CI** (2026-11-16, `gate (windows)` on `windows-latest`): `runtime`, `loader` and `preflight` all PASSED — WebView2 156.0.4314.58 on Windows 10.0.26100 — and the smoke then failed compiling the shim. That failure is fixed below; the window, controller and pump are still unproven.
- **`clang` on macOS is only a parse check** — it proves balanced braces, declared identifiers and arity against the hand-written prototypes, and proves nothing about the Windows ABI, link flags or runtime behaviour.
- **`src/app-loop.ts:63` dispatches win32 to `@/platform/windows`** — the arm passes `{ ...config, appName: config.app.name }`, so the window class carries the app name; `userDataDir` has no config key, so WebView2 always picks its own default folder.

## File layout, and why it is this many files

- **7 C units, numbered, joined by `shim-source.ts` in the only order that compiles** — `10_prelude`, `20_class`, `30_com`, `32_env`, `34_slots`, `40_window`, `42_webview`; the numbers are load order, not decoration.
- **`10_prelude.c` forward-declares `shim_webview_put_bounds`** — the window procedure in `20_class.c` resizes the controller that `42_webview.c` holds, so one side must see the other before either is defined.
- **`30_com.c` must precede `32_env.c`, which must precede `34_slots.c`** — the handler type and `handler_wait` come from `30`, `shim_environment`/`shim_controller` from `32`, and the slot helpers from `34`; reversing any pair gives an implicit-declaration error that TinyCC may accept and then call wrong.
- **`42_webview.c` owns the hwnd→controller table** — TypeScript passes an `HWND` number and never a COM pointer, which is what keeps `platform.ts` free of pointer arithmetic.
- **The table is a fixed 8-slot array** (`SHIM_MAX_WINDOWS`) — `shim_webview_new` returns 0 past that, so a ninth window fails loudly instead of corrupting memory.

## COM: the one rule that shaped every file

- **A COM method is unreachable through a bare function pointer** — it lives in `*(void ***)obj`, indexed by declaration order, so TypeScript can never call one and every slot crust needs gets a named C helper: `wv2_put_bounds` (6), `wv2_controller_close` (24), `wv2_navigate` (37), `wv2_env_create_controller` (environment 3), `wv2_controller_webview` (controller 25).
- **The handler is a C-built object with a static vtable** — `shim_handler` + `handler_vtbl`; one vtable serves both the environment and the controller because every `Invoke` is `(self, code, created)`.
- **`QueryInterface` answers every IID with itself** — WebView2 asks only for the handler interface it was handed; inventing handler IIDs from memory would fail harder than a stable wrong-but-harmless answer, so no GUID table exists anywhere in this layer.
- **`CreateCoreWebView2EnvironmentWithOptions` is the only export needed from `WebView2Loader.dll`** — and it is resolved at runtime, never linked: `32_env.c` calls `LoadLibraryW("WebView2Loader.dll")` + `GetProcAddress` once and keeps the handle for the process lifetime. TinyCC *can* import a DLL's export table, but only when that DLL's directory is on TinyCC's own library path, and that directory is wherever Edge is installed — a machine without it would lose the whole shim to a linker error instead of one symbol (2026-11-16).
- **`options` is passed `NULL`** — crust needs no additional browser arguments, and nothing in this layer wants an interface newer than the base environment.
- **Completion is a `PeekMessageW` drain with a 5 s bound, never a block** — WebView2 posts its completion to the creating thread's message queue, so a blocked thread waits out the whole timeout; `handler_wait` calls `shim_pump()` plus `Sleep(1)`.
- **`shim_pump()` is defined in the prelude and used by `30_com.c`** — same translation unit, so the call is visible without a prototype; splitting the unit would break it.

## FFI arguments: buffers, never strings

- **`bun:ffi` refuses a JavaScript string at an `FFIType.cstring` argument** — its error is `a JavaScript string is not valid here; return it from a 'cstring'-returning callback, or pass a pointer/TypedArray`, measured on Linux against real GTK where the throw landed at `createWindow` before C ran; Windows has the same shape (2026-11-16).
- **Every cstring argument goes through `cstring()` in `src/platform/windows/cstring.ts`** — one place builds the bytes and appends the NUL, and that NUL is the contract: C reads a NUL-terminated string and a buffer without one over-reads.
- **Seven cstring arguments cross, in four functions** — `shim_register_class` (name), `shim_window_new` (title, class name), `shim_window_set_title` (title), `shim_webview_new` (url, user data); no `ptr` argument takes a string anywhere in the layer.
- **An empty title or empty user-data folder is one NUL byte** — never a zero-length buffer and never an omitted argument, because C's `userData[0]` test is what turns "empty" into "let WebView2 pick its own folder".
- **`cstring.test.ts` injects a recording symbol table** — it asserts each cstring argument is a `Uint8Array` ending in 0 that decodes to the expected value, and that no argument anywhere in the call path is a JavaScript string.
- **`shim_window_set_title` is declared but has no caller** — the title is applied by `CreateWindowExW` inside `shim_window_new`; the setter is retyped to a buffer so its first caller cannot reintroduce the defect.
- **`window-open.ts` owns creation, `platform.ts` owns the lifecycle** — the split exists because the class plus the creation order together crossed the 200-line cap; the answer is another file, never a trimmed comment.

## Page loading: why there is no scheme here

- **A page-serving `crust://` scheme was built and then removed** (2026-11-16) — darwin has no such scheme either: `src/platform/darwin/shim/30_webview.c` loads the bridge URL directly with `-loadRequest:`, so a Windows-only scheme was a contract the framework does not have.
- **`crust://` is the app's deep-link scheme** (`src/config/types.ts` `urlScheme`, written into the plist) — a framework page-serving scheme with that name collides with an app's own deep links, which is the defect the removal fixes.
- **`createWindow` navigates on the URL the window was created with** — `platform.ts:144-145` resolves it then passes it to `shim_webview_new(hwnd, url, userData)`, which converts it to UTF-16 and calls `ICoreWebView2::Navigate` (slot 37) at `42_webview.c:51`, and nothing rewrites it in between.
- **A relative URL still becomes `about:blank` before it reaches C** — no browser takes a bare path, and the bridge URL is the runtime's, not the platform's; that rule is unchanged by the removal.
- **If a scheme is ever genuinely needed it gets its own name** — never `crust://`, and it would need a real resource table before any built app depends on it, which is the work the removed 302 stub did not do.

## Win32 traps already encoded

- **`IsWindow` is the whole liveness answer on Win32** — unlike AppKit's `-windowNumber`, which keeps its value after `-close`, a Win32 handle is destroyed with the window and reads 0 afterwards, so the registry needs no visible/minimized/hidden-app triple.
- **`WM_SIZE` reads `GetClientRect`, not `LPARAM`** — `LPARAM` packs a stale pair across a DPI change, and the controller would then be sized to the pre-change client area.
- **`WM_CLOSE` calls `DestroyWindow` and `WM_DESTROY` calls `PostQuitMessage`** — a title-bar close therefore ends the pump without any JavaScript involvement.
- **`CreateWindowExW` needs the class _name_, not the atom** — crust registers one class per app name and every window is an instance of it, which is why `shim_window_new` takes the class string.
- **The controller starts at zero size** — without the `put_Bounds` after creation the page renders nowhere and the window looks like a rendering failure rather than a sizing bug.
- **`ShowWindow` runs inside `shim_window_new`** — the window is shown before the controller exists; that ordering is unverified and is the first thing to check on a real machine.
- **`WM_GETMINMAXINFO` is not handled, so `minWidth`/`minHeight` do nothing** — the config field is carried but unenforced on Windows.
- **No DPI-awareness declaration exists in this layer** — bounds come from `GetClientRect` in physical pixels, so a scaled display may size the page differently than macOS does.

## TypeScript traps already encoded

- **`createPlatform(config, backend?)` takes the backend as its second argument** — injection is the only reason the five methods are testable at all, and `platform.test.ts` never constructs the default backend.
- **A missing runtime resolves `start()` and sets `unavailable`** — the same text then throws from `createWindow`, so an app can print the install remedy instead of dying in a stack trace; `platform.test.ts` pins that shape.
- **A shim that will not compile deliberately propagates out of `start()`** — a broken C unit is a defect in crust, not a missing runtime, so it must stay loud.
- **A controller that fails now reports `GetLastError`** — 126 (`ERROR_MOD_NOT_FOUND`) is `WebView2Loader.dll` not loading, and `window-open.ts` names that remedy instead of the generic "did not answer" text (2026-11-16).
- **`createWindow` on an existing label returns the existing handle** — a configured window is opened once and the app's own window loop then asks for the same labels, which must not become a second native window; darwin throws instead, and that divergence is intentional.
- **`quit()` is idempotent and calls `backend.exit(0)`** — the fake backend records the code, which is how the test watches a quit without exiting the runner.
- **`quit()` skips a window `IsWindow` already reports closed** — Win32 reuses a freed handle, so a second `Close` on a stale one faults.
- **`pump()` before `start()` still ticks** — the counter moves and nothing is drained, so the timer shape is identical with or without a window.
- **`bun fmt` reformats only the TypeScript** — the `.c` units are untouched by it, and the line cap counts them.

## Linking: why `-l` in `flags` links nothing (measured 2026-11-16)

- **The shim compiled and failed to link on the first real Win32 run** — `16 errors while compiling …`, one `unresolved reference to '…'` for every user32, ole32 and WebView2Loader call the unit makes.
- **The cause was the wrong option, not a missing library** — TinyCC's option parser sends `-l` to `args_parser_add_file`, which only appends the name to `state->files`; that queue is walked by the tcc CLI's `main` and never by an embedded libtcc, so `flags: ["-luser32", …]` was parsed and dropped with no error at all.
- **kernel32 was the one that resolved** — TinyCC's PE runtime adds `msvcrt` and `kernel32` itself through the real `tcc_add_library`, so those symbols never appeared in the failure and the flag list looked half-right.
- **`library` is the option that links** — `cc({ library: ["user32", "ole32", "kernel32"] })` reaches `tcc_add_library`, and a name it cannot find fails loudly as `tcc: error: library 'x' not found`.
- **Measured on bun 1.4.4**: `flags: ["-lbogusxyz"]` compiles clean; `library: ["bogusxyz"]` errors; a real `libcrustprobe.dylib` links only with `-L<dir>` in `flags` and returns its value — so `-L` does reach the search path while `-l` does not.
- **`-L` is applied immediately** (`case TCC_OPTION_L: tcc_add_library_path`) — so the system directory can be passed as a flag, and it is skipped when the path contains a space, because the option string is whitespace-split.
- **The system directory is already a library path on PE** — `tcc_add_systemdir` calls `GetSystemDirectoryA` and adds it, so `-L<System32>` is belt-and-braces rather than the mechanism.
- **`gdi32` is deliberately not linked** — nothing in the unit calls a gdi32 export: `GetClientRect` is user32 and no device context is created.
- **`link.test.ts` pins the whole seam** — the three libraries, no `-l` among the flags, the `-L` rule, the exact command line a failure prints, and that every `PREFLIGHT` module is either linked or resolved at runtime.
- **`compile()` attaches that command line to its own throw** — plus one line per library naming the file TinyCC would open, so a build failure names the missing library instead of leaving sixteen references to infer it from, and a throw that is not a build failure is no longer dressed up as a linker problem.
- **`cc()` returns `{ symbols, close }`, never the bare table** — casting the result straight to `WindowsShim` type-checks through `as unknown as` and makes every call `undefined`, which the real runner reported as `shim.shim_com_init is not a function` one step after the link was fixed (2026-11-16). `shimSymbols()` is the single unwrap, and `symbols.test.ts` pins it plus map-to-interface equality in both directions.

## Preflight

- **Two separate facts, two names in one message** — `WebView2Loader.dll` beside the binary and the Evergreen runtime under `%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application`; the loader can be present while the runtime is absent, and only the bootstrapper fixes that one.
- **The remedy URL is `https://go.microsoft.com/fwlink/p/?LinkId=2124703`** (Evergreen Bootstrapper) and appears once per message, never once per missing piece.
- **`PREFLIGHT` is 20 entries across `user32`, `kernel32`, `ole32` and `WebView2Loader`** — every entry names what breaks without it, and `preflight.test.ts` spot-checks the ten that matter so a shim call added without an entry fails the suite.
- **`preflight.test.ts` also asserts every entry has a `breaks` line** — a nameless entry is a message that says "something is missing" and helps nobody.
- **The runtime version sort uses numeric collation** — a plain string sort puts `100.x` before `99.x` and would report an old runtime as the newest.

## What the next lane must do first

- **Run it on a Windows machine before trusting any index** — every vtable index (`3`, `6`, `24`, `25`, `37`) is from `WebView2.h`'s declaration order and none has been checked against a live object.
- **The loader question is answered, not open** — `WebView2Loader.dll` is never linked; `32_env.c` resolves its one export with `LoadLibraryW` + `GetProcAddress`, so a machine without the loader still compiles the shim and gets the preflight message instead of a linker failure.
- **Check the `WNDCLASSEXW` (80 bytes) and `MSG` (48 bytes) sizes** — both are hand-written structs with no header to agree with, and a wrong size is a silent overwrite rather than an error.
- **Check `wchar_t` really is 2 bytes under the TinyCC target** — the whole string path assumes it, and `shim_wchar` is `unsigned short` to match.
- **Check the show-before-controller ordering** — a white or blank window on the first run most likely means the controller was created before the window had a client area.
- **Add the remaining surface in its own files, not in `platform.ts`** — menu, dialogs, tray, notifications, clipboard, screen, shortcuts and the postMessage bridge all live as darwin adapters today; each deserves a `windows/` module beside this one rather than another branch inside the class.
- **Never reintroduce a page-serving scheme to make `crust://` work on Windows** — the repo's platform contract says a page loads from the bridge URL, and `crust://` belongs to the app's deep links.
