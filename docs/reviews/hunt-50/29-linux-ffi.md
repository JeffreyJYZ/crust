# Linux FFI + preflight — assumptions carried in from other layers

Read-only hunt. Scope: `src/platform/linux/{shim-ffi,dialog-ffi,notify-tray-ffi,shim-symbols}.ts` and
`src/platform/linux/preflight{,.test}.ts`. Callers and the C the symbols are resolved against were
read only to establish how a defect is reached. Nothing was changed.

Files searched: `fd 'ffi|preflight' src/platform/linux` → 6 ffi/preflight files plus the two
preflight tests; `rg` over `src/**/*.ts` and `src/platform/linux/shim/*.c` for every symbol, caller
and `shim_sym` site. The JS symbol map and the `LinuxShim`/`LinuxDialogShim` interfaces are in sync
(59 names each, set difference empty); every mandatory C `shim_sym` is in `PREFLIGHT`. The defects
below are all at the boundary between layers.

**Count: 4 findings (1 high, 2 medium, 1 low).**

**Worst: F1 — `notify-tray-ffi.ts` compiles with raw `cc()` and never calls `linkError`, although its
own header says the translation already happens "on the platform's own path". On a machine missing
the libc linker script the raw TinyCC error is swallowed by both adapters and the user never sees
the install line.**

---

## F1 (high, worst) — the notification/tray compile unit dropped the libc-link translation

- `src/platform/linux/notify-tray-ffi.ts:103-105` — the header claims "`cc()` links only libc, and
  `linkError` already translates a missing `libc.so` linker script on the platform's own path."
  No such path exists in this file: `linkError` is not imported.
- `src/platform/linux/notify-tray-ffi.ts:111-128` — `cc({...})` is called bare, with no `try/catch`.
- Contrast `src/platform/linux/shim-ffi.ts:140-149`, the sibling unit: it wraps the same `cc()` call,
  extracts `error.message`, and rethrows `crust: ${linkError(detail)}`. `d563716` added that wrapper
  to the window shim only; `a93d6b3` later added this second `cc()` unit and copied its comment,
  not the wrapper. Windows' `compileNotifyTray` (`src/platform/windows/notify-tray-ffi.ts:95-99`)
  legitimately has no such wrapper because that unit links nothing — the Linux copy inherited the
  shape but not the condition.

**Reached:** a machine with GTK3 + WebKitGTK installed but no C development package passes
`PREFLIGHT` (nothing probes libc — see `preflight.ts:61-66`) and both compile units hit `cc()`.
The window shim reports `crust: ... install glibc-devel ... libc6-dev on Debian/Ubuntu ...`.
The notification/tray unit throws TinyCC's raw `library c not found`;
`src/platform/linux/notification-adapter.ts:62-68` catches it and answers
"the notification C unit could not be compiled, so nothing was sent", and
`src/platform/linux/tray-adapter.ts:36-41` catches it into a bare `handler-error`. The actionable
remedy disappears exactly on the second unit, and the only code that could have produced it is
sitting unused in `preflight.ts:86-94`.

---

## F2 (medium) — lazily-resolved namespaces are promoted to hard launch checks

- `src/platform/linux/preflight.ts:46-55` — six entries (`gtk_clipboard_get`,
  `gtk_clipboard_set_text`, `gtk_clipboard_wait_for_text`, `g_filename_to_uri`,
  `g_app_info_launch_default_for_uri`, `g_get_language_names`) are added to the mandatory launch
  list with the assumption "a machine that has GTK at all has them".
- `src/platform/linux/shim-ffi.ts:80-93` declares the same three namespaces as optional by design:
  "resolved lazily so an older GTK fails one namespace by name instead of refusing the launch".
  The C agrees — `src/platform/linux/shim/80_clipboard.c:3-4` resolves them with `shim_sym_or_null`,
  never in `shim_gtk_resolve`, explicitly "so a GTK too old for one of these fails `clipboard` by
  name instead of refusing to launch every app"; `81_opener.c:34-46` and `82_osinfo.c:14-25` do the
  same.
- This is the Windows `PREFLIGHT` pattern (`src/platform/windows/preflight.ts:105-114`, which lists
  even the dialog's comdlg32 entries) applied to a platform whose namespaces were deliberately
  given their own `*_ready()` gates.

**Reached:** `src/platform/linux/backend.ts:70-71` throws the whole `missing` list from `open()`
before `shim_lib_open()` is ever called. A GTK/GIO missing one of these six symbols therefore
refuses to launch an app that would otherwise have run with clipboard/opener/os-info answering
"unavailable" — the exact failure the lazy C path was written to avoid. The check is also not a
faithful readiness gate: `shim_clipboard_ready` additionally requires `g_free`
(`80_clipboard.c:34,40-43`), which is not in `PREFLIGHT`, so "preflight passed" does not imply the
namespace is usable. The error text at `preflight.ts:128` attributes a GIO symbol
(`g_app_info_launch_default_for_uri`) to `libgtk-3-0` and tells the user to reinstall GTK.

---

## F3 (medium) — the probe assumes darwin's "probe the real shim" contract, but probes a different open path

- `src/platform/linux/preflight.ts:3` states the contract is "the same as the darwin one". On darwin
  that is literally true: `src/platform/darwin/preflight.ts:181-190` probes through
  `shim().symbols`, the same shim the app uses.
- `src/platform/linux/preflight.ts:104-114` instead opens the library a second time through bun:ffi
  with a synthetic symbol (`args: [], returns: FFIType.void`) and closes it immediately. The real
  load is C's `dlopen(soname, RTLD_NOW | RTLD_GLOBAL)` at
  `src/platform/linux/shim/10_prelude.c:24-25,57-60`, followed by `shim_sym` for each mandatory name.
  Nothing ties the two opens together: the flags, the handle and the resolve order are all different.
- `src/platform/linux/backend.ts:51-53` nevertheless claims "the launch path and the smoke cannot
  disagree about what 'preflight passed' means".

**Reached:** `preflightErrors()` can return `[]` while `shim_lib_open()` still fails. Any condition
that the bun:ffi open tolerates but the C `RTLD_NOW | RTLD_GLOBAL` open rejects — an unresolved
transitive dependency of `libwebkit2gtk-4.1.so.0`, for example — is reported as "all libraries
present" by `backend.ts:70`, then surfaces one line later at `backend.ts:73-76` as C's
`cannot load ...` plus only the generic `INSTALL_LINE`. The probe declares success without ever
calling the one function (`shim_lib_open`) whose failure it claims to predict.

---

## F4 (low) — the compiler-level remedy assumes the Fedora package name everywhere

- `src/platform/linux/preflight.ts:66` sets `LIBC_PKG = "glibc-devel"`, and `:88-93` prints
  `install ${LIBC_PKG}` as the primary instruction. `glibc-devel` is the Fedora/openSUSE name;
  Debian and Ubuntu ship `libc6-dev` and appear only in a parenthetical and in
  `LIBC_INSTALL_LINE` (`:69-70`).
- `preflight.test.ts:120-125` pins the Fedora name as the expectation, so the test cannot catch a
  wrong default for the other family.

**Reached:** any Debian/Ubuntu user hitting the translated compile error through
`shim-ffi.ts:145-148` is first told to install a package that does not exist in `apt`; the correct
name is demoted to a parenthetical. The information is present but the headline instruction is
wrong for one of the two documented families.

---

## What was checked and found sound

- 59 FFI symbol declarations in `shim-symbols.ts` match the 59 `LinuxShim`/`LinuxDialogShim`
  interface names exactly; no argument or return arity drift against the C prototypes inspected.
- Every symbol the C resolves at launch (`shim_webkit_resolve`, `shim_gtk_resolve`,
  `shim_pump_resolve` — `30_webview.c:125-126`, `40_window.c:17-24`, `50_pump.c:11-12`) is present
  in `PREFLIGHT`.
- `NOTIFY_TRAY_PREFLIGHT` is kept complete by `notify-tray-source.test.ts:94-101` against the C's
  `shim_sym` calls, including the same GLib symbol resolved from both handles.
- `cstring` (NUL-terminated `Uint8Array`, never a JS string) is consistent with every `CS` argument
  in both symbol tables and with the callers in `backend.ts`, `keychain.ts` and the adapters.
