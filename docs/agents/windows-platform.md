# Windows platform lane — measured facts, traps, decisions

Written 2026-11-16 by the lane that built `src/platform/windows/`. Nothing here ran on Windows: the machine is macOS, so every bullet marked _decision_ is a reading of the WebView2 docs and the darwin precedent, not a measurement, and every bullet marked _trap_ is a trap found by static reasoning or by clang.

## Status

- **The whole layer is unproven on Win32** — no Windows machine was available, so no `user32`, `ole32` or WebView2 call in this tree has ever executed on the machine it was written on; treat every Windows run as the real test.
- **Gates that did run and pass**: `bun test src/platform/windows` (52 pass across 7 files), `bun run check:lines` (PASS), `bun run scripts/windows-smoke.ts` (refuses with `unavailable: … needs Windows; running darwin/arm64`, exit 1, which is correct), and `clang -fsyntax-only -std=c99 -Wall` over the assembled C unit with zero diagnostics.
- **The first real Win32 runs happened in CI** (2026-11-16, `gate (windows)` on `windows-latest`, WebView2 156.0.4314.58 on Windows 10.0.26100): `runtime`, `loader` and `preflight` PASS; then a link failure (every `-l` flag dropped), then a `0xFFFFFFFFFFFFFFFF` crash at the first call (a symbol-table unwrap, not the link), and now `com + class` PASSES — `CoInitializeEx` and `RegisterClassExW("crust-smoke")` both executed — before a crash in the window path. Two COM defects found in that run are fixed below; the window, controller and pump are still unproven.
- **`clang` on macOS is only a parse check** — it proves balanced braces, declared identifiers and arity against the hand-written prototypes, and proves nothing about the Windows ABI, link flags or runtime behaviour.
- **`src/app-loop.ts:63` dispatches win32 to `@/platform/windows`** — the arm passes `{ ...config, appName: config.app.name }`, so the window class carries the app name; `userDataDir` has no config key, so WebView2 always picks its own default folder.

## File layout, and why it is this many files

- **8 C units, numbered, joined by `shim-source.ts` in the only order that compiles** — `10_prelude`, `12_win32`, `20_class`, `30_com`, `32_env`, `34_slots`, `40_window`, `42_webview`; the numbers are load order, not decoration.
- **`12_win32.c` binds every Win32 pointer the prelude declares** — it comes second because the prelude's `shim_utf16` and `shim_pump` call through those pointers, and `SHIM_BIND` needs both the declarations and the resolver imports in scope.
- **`10_prelude.c` forward-declares `shim_webview_put_bounds`** — the window procedure in `20_class.c` resizes the controller that `42_webview.c` holds, so one side must see the other before either is defined.
- **`30_com.c` must precede `32_env.c`, which must precede `34_slots.c`** — the handler type and `handler_wait` come from `30`, `shim_environment`/`shim_controller` from `32`, and the slot helpers from `34`; reversing any pair gives an implicit-declaration error that TinyCC may accept and then call wrong.
- **`42_webview.c` owns the hwnd→controller table** — TypeScript passes an `HWND` number and never a COM pointer, which is what keeps `platform.ts` free of pointer arithmetic.
- **The table is a fixed 8-slot array** (`SHIM_MAX_WINDOWS`) — `shim_webview_new` returns 0 past that, so a ninth window fails loudly instead of corrupting memory.

## COM: the one rule that shaped every file

- **A COM method is unreachable through a bare function pointer** — it lives in `*(void ***)obj`, indexed by declaration order, so TypeScript can never call one and every slot crust needs gets a named C helper: `wv2_put_bounds` (6), `wv2_controller_close` (24), `wv2_navigate` (37), `wv2_env_create_controller` (environment 3), `wv2_controller_webview` (controller 25).
- **The handler is a C-built object with a static vtable** — `shim_handler` + `handler_vtbl`; one vtable serves both the environment and the controller because every `Invoke` is `(self, code, created)`.
- **`QueryInterface` answers every IID with itself** — WebView2 asks only for the handler interface it was handed; inventing handler IIDs from memory would fail harder than a stable wrong-but-harmless answer, so no GUID table exists anywhere in this layer.
- **`CreateCoreWebView2EnvironmentWithOptions` is the only export needed from `WebView2Loader.dll`** — and it is resolved at runtime like everything else: `32_env.c` calls `LoadLibraryW("WebView2Loader.dll")` + `GetProcAddress` once and keeps the handle for the process lifetime, so a machine without the loader loses one symbol instead of the whole shim.
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

## Linking: `cc()` links nothing at all (measured 2026-11-16)

- **The import-thunk theory is REFUTED** — the bisect ran on the runner and all three routes answered: `import-kernel32` `4680`, `import-user32` `1024`, `dynamic-kernel32` `6732`. TinyCC's PE import thunks work, so no crash in this layer was ever the thunk, and nothing should be attributed to it again.
- **`cc()` still links nothing, for three reasons that survive the refutation** — a resolved pointer needs no library path or `-L` on the runner; a missing export is a named message from `shim_win32_ready` instead of a whole-shim link failure; and the design is now *proven on Windows*, because `CoInitializeEx` and `RegisterClassExW` both executed through resolved pointers.
- **`-l` in `flags` links nothing** — TinyCC's option parser sends `-l` to `args_parser_add_file`, which only appends the name to `state->files`; that queue is walked by the tcc CLI's `main` and never by an embedded libtcc, so the flag is parsed and dropped with no error at all. That was the real cause of the sixteen unresolved references.
- **`library` is the option that reaches the linker** — `cc({ library: ["user32"] })` calls `tcc_add_library`, and a name it cannot find fails loudly as `tcc: error: library 'x' not found`; `-L` in `flags` does reach the search path, while `-l` does not (both measured on bun 1.4.4).
- **The unit imports exactly two symbols** — `LoadLibraryA` and `GetProcAddress`, both kernel32, which TinyCC's PE runtime links for its own CRT whatever `cc()` asks for. Verified by compiling the unit here: TinyCC reaches relocation and reports only `unresolved reference to '_LoadLibraryA'` and `'_GetProcAddress'`, so nothing else in the unit is an import.
- **`12_win32.c` is the whole surface** — one `LoadLibraryA` per module, one `GetProcAddress` per function, cached in statics the prelude declares; `SHIM_BIND` uses `__typeof__` so each pointer keeps its exact prototype and no call site is retyped.
- **A function pointer is called exactly like a function** — every call site in `20_class.c`, `40_window.c` and `42_webview.c` still reads `CreateWindowExW(…)`, so the change is one part file rather than a rewrite.
- **`shim_win32_ready` is asked before anything else** — a machine missing an export is a message from `start()` instead of a null call; `shim_utf16`, `shim_pump` and `shim_post_quit` also check, and `shim_last_error` null-tests its own pointer because it answers during failures.
- **`imports.test.ts` pins the seam** — exactly two `extern`s, no `library:`/`flags:`/`-l`/`-L` in the `cc()` call, every declared pointer bound exactly once (a forgotten bind is a null call), and every preflighted module loaded by name.
- **`compile()` attaches the tcc command line to its own throw** — so a build failure names what TinyCC was handed, and a throw that is not a build failure stays undecorated.
- **`cc()` returns `{ symbols, close }`, never the bare table** — casting the result straight to `WindowsShim` type-checks through `as unknown as` and makes every call `undefined`, which the real runner reported as `shim.shim_com_init is not a function`. `shimSymbols()` is the single unwrap, and `symbols.test.ts` pins it plus map-to-interface equality in both directions.
- **`scripts/windows/stages.ts` prints every call before making it** — `stage <name> …` then `stage <name> ok <value>`, one child with `stdout: "inherit"` so the line naming the call survives the crash. Two runs died in the middle of `createWindow` with only "after `com + class`" to go on, which is why it exists.

## The `0xFFFFFFFFFFFFFFFF` crash: a COM vtable, not a thunk

- **The stage probe put the crash inside `webview_new`** (2026-11-16) — `win32_ready`, `com_init`, `register_class`, `window_new`, `client_width` and `client_height` all answered through the resolved pointers, and the next line had no `ok`: the fault is in the environment or controller, i.e. the first place a hand-built COM object is handed to Windows.
- **`handler_vtbl` was the only static initialiser holding code addresses in the whole unit** — `void *handler_vtbl[4] = {(void *)handler_qi, …}` is a *relocated* pointer in the image, and the first COM callback through it jumped to `-1`; the window class took its function pointer as a call argument and worked, which is the difference the evidence shows.
- **The table is now filled at run time** in `handler_init`, once, before the first COM call — an assignment is not a relocation, so the failure cannot recur however TinyCC relocates `.data`.
- **The handler objects are statics, not stack locals** — WebView2 keeps the pointer until its completion arrives, so an object whose frame has returned is a callback into freed memory; `g_env_handler` and `g_ctrl_handler` live for the process.
- **The table is 8 slots, and the four past `Invoke` refuse** — `QueryInterface` answers every IID, so WebView2 is told this object has interfaces it does not; a call to one of those must land on `handler_unsupported` (`E_NOINTERFACE`) rather than on whatever followed the table in `.bss`.
- **`shim_handler_prepare` and the four readbacks make the layout a number** — the object's address, the table's address, the object's first field and each entry, so "the first field is not the table" or "an entry is `0xffffffff`" is printed instead of inferred.
- **`webview_new` is five exports plus a composite** — `env_begin`/`env_wait`/`env_callback`, `controller_begin`/`controller_wait`/`controller_callback`, `webview_attach`, `webview_navigate`, each returning the HRESULT of its own call and of the callback that answered it. A refused call, a callback that never arrived and a callback that failed are three different failures and now print as three lines.
- **`Navigate` was called at slot 37, which is `GetBrowserProcessId(UINT *)`** — `Navigate` is the fifth method of `ICoreWebView2`; slot 37 wrote a process id over the URL and returned `S_OK`, so navigation silently did nothing. Verified against the published order (docs.rs/webview2-sys `ICoreWebView2VTable`).
- **Every slot is now a named `SHIM_SLOT_*` in the prelude with the order it was checked against**, and `slots.test.ts` re-derives each index from a transcribed method list — the numbers are checked against the header's order, not against themselves.
- **`put_Bounds(RECT)` is called through a pointer parameter** — a 16-byte struct is passed by reference on x64, so declaring the parameter as `shim_rect *` is the call the ABI already makes, and it stops relying on TinyCC's struct-by-value codegen that no Mac can test.
- **A `__stdcall`/`cdecl` mismatch is not a candidate on either target** — x64 and arm64 each have exactly one calling convention, and `__stdcall` is a no-op there; it would only matter on x86, which this layer does not build for.

- **`scripts/windows/bisect.ts` measures which route survives** — three one-line units, one child process each (`import-kernel32`, `import-user32`, `dynamic-kernel32`), because a bad call takes the process down and the next experiment has to survive it. The smoke prints the three verdicts and does not gate on them: a FAIL there is the measurement, not a regression.
- **The PE target only exists in Bun's TinyCC on Windows** — on macOS `library: ["user32"]` fails at link, so the bisect measures nothing here and the run must happen on the runner.

## Preflight

- **Two separate facts, two names in one message** — `WebView2Loader.dll` beside the binary and the Evergreen runtime under `%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application`; the loader can be present while the runtime is absent, and only the bootstrapper fixes that one.
- **The remedy URL is `https://go.microsoft.com/fwlink/p/?LinkId=2124703`** (Evergreen Bootstrapper) and appears once per message, never once per missing piece.
- **`PREFLIGHT` is 20 entries across `user32`, `kernel32`, `ole32` and `WebView2Loader`** — every entry names what breaks without it, and `preflight.test.ts` spot-checks the ten that matter so a shim call added without an entry fails the suite.
- **`preflight.test.ts` also asserts every entry has a `breaks` line** — a nameless entry is a message that says "something is missing" and helps nobody.
- **The runtime version sort uses numeric collation** — a plain string sort puts `100.x` before `99.x` and would report an old runtime as the newest.

## What the next lane must do first

- **Run it on a Windows machine before trusting any index** — every vtable index (`3`, `6`, `24`, `25`, `37`) is from `WebView2.h`'s declaration order and none has been checked against a live object.
- **The stage probe is the first thing to read in the next run** — its last line names the call that died, and `webview_new` is now nine lines (`env_begin`, `env_wait`, `env_callback`, `controller_begin`, `controller_wait`, `controller_callback`, `webview_attach`, `webview_navigate`) instead of one black box. A stop at `env_begin …` is the environment call itself; a stop after `env_wait ok 0` is a callback that never arrived; `env_callback ok 0x…` names a callback that failed.
- **The handler readback prints before anything is handed to Windows** — `handler vtbl 0x… object 0x… first 0x…` must show `first` equal to `vtbl`, and the eight `handler entry` lines must all be non-zero and different from `0xffffffff`.
- **Check the `WNDCLASSEXW` (80 bytes) and `MSG` (48 bytes) sizes** — both are hand-written structs with no header to agree with, and a wrong size is a silent overwrite rather than an error.
- **Check `wchar_t` really is 2 bytes under the TinyCC target** — the whole string path assumes it, and `shim_wchar` is `unsigned short` to match.
- **Check the show-before-controller ordering** — a white or blank window on the first run most likely means the controller was created before the window had a client area.
- **Add the remaining surface in its own files, not in `platform.ts`** — menu, dialogs, tray, notifications, clipboard, screen, shortcuts and the postMessage bridge all live as darwin adapters today; each deserves a `windows/` module beside this one rather than another branch inside the class.
- **Never reintroduce a page-serving scheme to make `crust://` work on Windows** — the repo's platform contract says a page loads from the bridge URL, and `crust://` belongs to the app's deep links.
