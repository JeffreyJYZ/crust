# Hunt 22 — system plugins: keychain, autostart, power, dock, i18n

Read-only hunt. No `src/**`, `site/**` or test file was changed. Searches used `rg`, never `grep`.
Two throwaway probes under the approved opencode temp dir exercised pure plugin functions only;
neither touched a real keychain, dock, notification center or LaunchAgent.

**Verdict: eight findings. One is high — macOS `autostart.enable` writes a LaunchAgent that launchd
cannot execute, yet answers `enabled: true` and `isEnabled` agrees. Four are medium or
medium-low, three are low.**

## Findings, worst first

### F1 — High — macOS autostart points launchd at a `.app` directory, so nothing starts at login

`src/plugins/autostart-macos.ts:20-34` writes `ProgramArguments` with a single element, the raw
`appPath`. `src/plugins/autostart.ts:130-139` accepts that path after only a `stat` existence check,
and the guide's own example passes `/Applications/Notes.app`
(`site/app/docs/guides/autostart/page.mdx:8-14`).

launchd's first `ProgramArguments` element is the executable passed to `execve`. A `.app` bundle is
a directory, so the job fails at login; launchd never reads `Contents/MacOS/<CFBundleExecutable>`
from it. The two working forms are the executable path or `/usr/bin/open` plus the bundle path —
the latter is what third-party launchd examples use for GUI apps. Neither appears in the plist.

The false success is the worse half: `enable` returns `{ ok: true, enabled: true, path }` after
checking only that the file exists, and `isEnabled` on macOS is literally `exists(path)`
(`autostart-macos.ts:47`). A page believes autostart is armed; at the next login nothing launches.
Existing tests assert only plist text, so they pass.

Evidence: `plistDocument` lines 26-30; `enable` read-back at `autostart.ts:138`; the guide example.
Proof status: static plus external launchd convention; not reboot-tested (would require taking over
the login session). Reachability: every macOS `enable` call with the documented `.app` argument.

### F2 — Medium — i18n narrows a locale on `-` only, so underscore tags get the wrong language and direction

`src/plugins/i18n-messages.ts:74` computes the language fallback as `wanted.split("-")[0]`.
`src/plugins/i18n-locale.ts:27` deliberately splits on `/[-_]/`. The two disagree.

Measured with a pure probe (`i18n-probe.ts`): catalogue `{ en, ar }`, preferred locale `ar_SA`.

```
underscore resolve: {"locale":"en","messages":{"greeting":"Hello"}}
hyphen resolve:     {"locale":"ar","messages":{"greeting":"مرحبا"}}
dir ar_SA:          rtl
translate ar_SA:    {"ok":true,"locale":"en","dir":"ltr","text":"Hello"}
```

`textDirection("ar_SA")` says RTL, but `translate` and `messages` answer English with `dir: "ltr"`.
Arabic-preferring users get LTR English whenever the catalogue has no `ar_SA` entry and `ar` is not
the first key. Reachable through `setLocale({ locale: "ar_SA" })`, through a loader file named
`ar_SA.json`, and through any native locale that uses underscores.

### F3 — Medium-low — `i18n.load` replaces a whole locale table, silently dropping keys supplied in code

`src/plugins/i18n.ts:121` uses `Object.assign(catalogue, await loader(...))`. That is a merge at
locale granularity, not key granularity: a loaded locale with the same name replaces the table
wholesale.

Measured (`i18n-merge-probe.ts`): `messages: { en: { title: "Crust", greeting: "Old hello" } }`
plus a loader returning `{ en: { greeting: "New hello" } }` leaves:

```
{"ok":true,"locale":"en","dir":"ltr","messages":{"greeting":"New hello"}}
```

`title` is gone. The existing test `i18n-load.test.ts` asserts only that *locales* already supplied
survive, so this passes the gate. A page that ships default strings in code and loads a directory
loses the defaults for every locale the directory also names.

### F4 — Medium-low — native power failures are flattened into plausible readings; `available` is dead on the real path

Two layers both fabricate success:

- `src/platform/darwin/shim/105_power.c:119-126` sets `out[0] = 1` when `pw_battery()` returns -1
  (IOKit answered nothing) and still returns 1 ("IOKit answered"). Its own reason string says
  "no battery answered, so the process is treated as on wall power".
- `src/platform/darwin/power.ts:87` therefore reports `onAc: true, batteryPercent: null`, with no
  `available: false`. The plugin's refusal at `power.ts:100-110` only triggers on a C *compile*
  failure, never on a failed runtime read.
- `power.ts:137` maps a non-finite idle value to `0`, and `power.ts:144` does the same in the real
  adapter (`seconds > 0 ? seconds : 0`). A broken idle clock reads as "the user just typed".

`power-native-refusal.test.ts` states that a fabricated read is a typed failure, but only proves it
against a fake adapter that chooses to return `{ available: false }`. The shipped darwin adapter has
no path to that answer for a runtime failure. An app that locks the screen after N idle seconds
never locks when the clock read fails.

### F5 — Low-medium — `dock.badgeLabel()` re-applies a 255-byte-truncated label, so a read mutates a long badge

`src/plugins/dock.ts:120-127` probes tile liveness by re-applying whatever `badgeLabel()` returned.
`src/platform/darwin/shim/104_dock.c:88-101` copies the badge into a 256-byte static buffer and stops
at 255 bytes, with no error signal. `crust_dock_set_badge` accepts any length (`104_dock.c:60-77`).

Consequence: set a badge longer than 255 UTF-8 bytes (allowed — the contract only says "short
text"), then call `dock.badgeLabel()`. The read returns a truncated string, the plugin's idempotent
set writes that truncation back, and the badge is now permanently shorter. The command is
documented as a read.

Proof status: static from C and TypeScript source. Not runtime-executed: setting a real dock badge
would touch the human's dock, which the brief forbids. The liveness probe itself is intentional;
the truncation is the defect.

### F6 — Low — a `__proto__.json` locale file pollutes the loader's catalogue prototype

`src/plugins/i18n-load.ts:45` assigns `catalogue[file.slice(0, -5)] = parsed`. A file named
`__proto__.json` hits the inherited setter and replaces the object's prototype instead of adding a
locale. Measured (`i18n-proto-probe.ts`):

```
keys: [ "en" ]
own __proto__: false
loaded.pwned: yes
prototype: { pwned: "yes" }
```

`Object.keys` hides it, so `available` never names it, but `resolveCatalogue`'s
`catalogue[candidate]` can now resolve a locale that has no file. Requires control of a locale
directory's filenames; low severity, but the failure is silent.

### F7 — Low (documentation) — i18n guide understates plural support by two categories

`site/app/docs/guides/i18n/page.mdx:53` says "A catalogue carries two forms, so every other category
(`few`, `many`, `zero`) lands on `_other`." The code defines all six `Intl.PluralRules` categories
(`i18n-messages.ts:22-40`), and `i18n-locale.test.ts` explicitly requires Arabic `zero/two/few/many`
to be distinct. A reader following the guide will ship only two forms and get wrong Arabic strings.
The command table at the top of the same page also omits the `dir` field every answer carries.

### F8 — Informational — `KeychainAdapter.platform` is declared and populated but never read

`src/plugins/keychain-types.ts:57` requires every adapter to carry `platform`; all three platform
halves set it. `rg '\.platform'` over the plugin and adapters finds no read — refusal wording comes
from the separate `platform` argument to `createKeychainPlugin` (`keychain.ts:83`). An adapter whose
`platform` disagrees with that argument produces a refusal naming the wrong OS API, and the field
gives no protection. Dead contract, not a live bug.

## Checked and found sound

- Keychain: NUL/empty name rejection before any adapter call, empty secret treated as real, missing
  credential as `{ found: false }`, write refusal as `handler-error`, no file fallback, bounded
  re-read of growing secrets, Windows `assertName` backslash collision guard, Linux refusal naming
  libsecret and the install line.
- Autostart: atomic temp-plus-rename write, Windows by-name refusal with no stray macOS tree,
  Linux `Hidden`/`X-GNOME-Autostart-enabled` read-back, double escaping of `$` in `Exec`, id path
  separator refusal, read-back after write and after delete.
- Power: assertion deduplication and release-on-exit, refused release as `handler-error`, six
  subscribe commands each with a named notification and a `not-implemented` path on absent methods,
  page handler exceptions contained inside the native callback.
- Dock: empty-label null-pointer path, `NSCriticalRequest` mapping, fraction guard in C and JS,
  typed refusal when the progress indicator cannot be installed.
- i18n: six-form plural selection and fallback order, placeholder refusal, missing-key refusal,
  async loader, `Intl` invalid-tag fallback, `textDirection` RTL base-language set.

## Method

Read-only source review of `src/plugins/{keychain,autostart,power,dock,i18n}*` and their native
halves (`src/platform/{darwin,windows,linux}/*`, including the C shims), plus the five guide pages
and runtime registration. `rg` scoped to those paths throughout. Two Bun probes ran against pure
plugin functions in the approved temp directory; both processes exited. No GUI app, real dock,
keychain, login item or notification center was touched. No repository file was modified by this
hunt other than this report.
