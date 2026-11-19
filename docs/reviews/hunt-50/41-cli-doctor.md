# Hunt 50 — `src/cli/doctor/` (checks that cannot fail)

Read-only hunt. Count: **5 findings** (1 high, 2 medium, 2 low). Worst first.

---

## 1. `gatekeeper` can never fail, and calls every signed bundle "unknown" — HIGH (worst)

`src/cli/doctor/bundle.ts:27-36` (reached from `src/cli/doctor.ts:99-101` → `checkBundle(dir)`).

Both lines this function emits are hard-coded `status: "note"` (lines 27 and 32). There is no `fail` branch anywhere in `checkBundle`, so the Gatekeeper verdict never contributes to the failure count at `src/cli/doctor.ts:113`. Worse, the only state it recognises is the lowercase substring `"adhoc"` (line 29):

- ad-hoc bundle → note `"ad-hoc signed: refused elsewhere…"` (correct wording, still only a note);
- valid Developer ID bundle → `describeSignature` returns `flags=0x0(…) Authority=Developer ID Application: …`, `adHoc === false` → note `"signature state unknown — crust build --sign needs CRUST_SIGNING_IDENTITY"` (**false**: signature is known and good);
- unsigned bundle → `codesign -dv` returns `… code object is not signed at all` (a known string, not a throw — `run` never throws on non-zero exit, `src/packaging/exec.ts:18-31`), `adHoc === false` → the same **false** "unknown" note;
- `codesign` missing (spawn ENOENT) → `.catch(() => undefined)` (line 28) → the same "unknown" note.

So a check named `gatekeeper`, whose stated job is to report what a recipient meets, can neither fail nor report a good signature. Doctor prints `all checks passed` and exits 0 for a bundle that has no Developer ID signature and will be refused on another Mac.

**Measured:** `describeSignature(<unsigned file>)` → `"/…/cc-probe.c: code object is not signed at all"`, `"adhoc" included = false` → `bundle.ts:33-35` picks the "signature state unknown" branch. The only way a build artifact reaches this code is a normal `dist/` bundle (`findBuildArtifact`, `src/cli/util.ts:155-160`), i.e. exactly when the check matters.

---

## 2. The macOS version floor silently disappears when `sw_vers` yields nothing — MEDIUM

`src/cli/doctor/environment.ts:64` and `:103-114`.

`osVersion = await shellOutput(["sw_vers", "-productVersion"])`. `shellOutput` (`src/cli/doctor/check.ts:13-22`) catches **every** error and returns `undefined`; an empty successful output becomes `""`. The whole floor check sits behind `if (config && osVersion)` (line 103). So when `sw_vers` cannot be spawned, is denied, or prints nothing, no `macos` check is emitted at all — not an "unreadable" fail, just absence. A project whose `build.minimumSystemVersion` is above the running OS then still reports `all checks passed` and exits 0. There is no companion check for "could not read OS version".

**Reached:** `doctor()` → `checkEnvironment(options)` with a config that sets `build.minimumSystemVersion` and any failure/empty result from `sw_vers`.

---

## 3. `dev port` cannot fail when the accept probe times out — MEDIUM

`src/cli/doctor/dev-port.ts:35-50`, `:79-80`, `:91-99`.

`portAccepts` races the TCP connect against `Bun.sleep(750).then(() => false)` (line 49). A port that is genuinely bound but slow to accept (loaded machine, full backlog, firewall delay) yields `listening === false`. `classifyDevPort`'s **only** fail branch requires `listening === true` (line 91). With `answered === false` execution falls to line 79-80 and the check reports `ok — port … is free`. With `answered === true` it reports the "proxy or a remote host" note (line 100-104). Either way a real port holder is never flagged; `crust dev`'s `strictPort` then refuses to start even though doctor was green.

**Reached:** `doctor()` → `checkDevServer(config.dev.url)` (line 50) with a loopback URL whose port is held by a process whose accept exceeds 750 ms. The fail branch is reachable only when `portAccepts` resolves `true` before the race deadline.

---

## 4. The fatal `FFIType.cstring` JS-string trap is only a note, and only one-line — LOW

`src/cli/doctor/scan.ts:108-124`.

When an app source contains `FFIType.cstring` and a `.fn("literal")` call on the **same line**, doctor emits `status: "note"` (line 117). That exact pattern is the documented fatal case — a JS string crossing into compiled `const char *`, which crashes the process with no JavaScript error — yet notes never count toward the exit code (`src/cli/doctor.ts:113`). A conversion spread over multiple lines, or one passing a variable rather than a string literal, does not even produce the note (the regex at lines 110-113 requires one line and a quoted argument).

**Reached:** `doctor()` → `sourceSection(dir, config !== undefined)` (line 76) on an app directory with a `.ts`/`.c` source that declares a cstring FFI symbol and calls it with a literal.

---

## 5. A throwing check destroys the whole report instead of producing `[fail]` — LOW

`src/cli/doctor.ts:30-120` (no error boundary), with reachable throw sites inside the doctor files: `src/cli/doctor/bridge.ts:71-80` (`fetch` in a `try`/`finally` with no `catch`), `src/cli/doctor/extensions.ts:26` (`doctorExtensions` → `exec` → `Bun.spawn` can throw on EACCES/race), `src/cli/doctor/platform.ts:29` (shim part reads are not caught).

`doctor()` awaits every check before it prints anything (print loop at lines 106-111). Any rejection before that point is an unhandled rejection: the user gets a stack trace, zero `[ok]`/`[fail]` lines, no `N checks failed`, and no clean summary. The extension check in particular cannot report a failure — it can only abort the command — because `failures` is read from `report.files` (extensions.ts:29) which is never reached when `doctorExtensions` throws.

**Reached:** e.g. `checkBridge` binds successfully but its `fetch` at bridge.ts:72 rejects; or a `native/` project whose toolchain binary is present at lookup time but fails to spawn.

---

## Notes on checks deliberately excluded

- `bun` (`environment.ts:61`) is a version report, permanently `ok` by design; not a detector.
- `bundle` (`bundle.ts:27`) is note-only by design; listed above only as context for finding 1.
- `notScanned`, `dev watch`, `not checked` notes are intentional non-failures.
- `checkShim` was probed and is **not** a finding: `cc()` throws when a declared symbol is missing (`cc()` with `shim_app_load` absent from source → `"shim_app_load" is missing from …`), so it verifies both compilation and required symbols.
