# Hunt 20 — claim validation

Every finding is checked here before it is believed. **Validated** = I reproduced it, or read the exact
code path and could not falsify it. Method: read the report, read the code it names, and for anything
claimed `measured` or costing data or security, reproduce it in a throwaway probe at the repo root,
deleted after the run.

## Validated — reproduced

### fs scope escape — Critical (`02-fs.md`)

A raw `<scope>/link/../secret.txt`, with `link` a symlink out of the grant, is checked as
`<scope>/secret.txt` — inside — while the OS resolves `link/..` through the link.

```
raw        …/scope/link/../secret.txt
canonical  …/scope/secret.txt      ← lexical fold, contains() says true
Bun.file   "ROOT-SECRET"           ← the file OUTSIDE the scope
node fs    "ROOT-SECRET"
```

Reproduced through the plugin's own `canonical()`/`contains()`, so the check that allows and the call
that reads are the same functions the plugin uses. Two earlier probes of mine missed it because
`path.join()` normalises `..` before the string is handed over; the attack needs a raw string, which is
what a page sends.

### `store` concurrent writes lose keys — High (`03-store-db.md`)

```
seed = set(seed: 0)
Promise.all([set(a: 1), set(b: 2)])   →   raw { "seed": 0, "a": 1 }   ← b gone
```

Reproduced against `createStorePlugin`: each mutating command reads the whole snapshot, merges, writes
it back, with no serialisation.

### `crust init --dir 123` scaffolds into the current directory — Medium (`11-cli.md`)

```
$ crust init --dir 123
crust init — /private/var/…/tmp.4C2XLIrJ6k      ← the CWD, not a `123` directory
created .github/workflows/release.yml, crust.config.ts, main.ts, …
no 123 dir
```

Reproduced in a temp cwd. mri coerces `123` to a number and the translate step drops non-strings, so
the flag is silently ignored and the default is used.

## Validated — read, mechanism confirmed in code

### Relative `window.create` can carry the bridge token to a foreign origin — High (`05-url-surfaces.md`)

`src/plugins/window-create.ts:56-79` classifies a relative URL as "own" and appends
`?window=<label>&token=<credential>` **before** the adapter resolves it
(`src/platform/darwin/window-adapter.ts:29-49`). The adapter resolves against `documentBase()`, which is
the first *tracked* window whose stored URL is `http(s)` — and `window.create` hands a foreign absolute
URL through untouched by design. Close the bridge window and the foreign one becomes the base, so
`/x?window=child&token=SECRET` resolves to `https://attacker.example/x?window=child&token=SECRET`.

Not reproduced end to end (needs a GUI app); the append-before-resolve order and the `documentBase()`
source are both in the code, and `new URL` composition is arithmetic.

### Every crust app shares one `window-state.json` — High (`16-persistence.md`)

`createWindowStatePlugin({ native })` at `runtime-plugins.ts:175` and
`runtime-plugins-other.ts:105,116` passes no `app`/`root`, so two different apps write the same
`crust/window-state.json`.

### `probe()` keeps `code: 0` after its own SIGTERM — Medium (`13-e2e.md`)

`scripts/e2e.ts:132` and `scripts/e2e-dev.ts:86` assert `run.code === 0` with no `timedOut` guard, so a
deadline-killed app can print a PASS "exit 0". The suites that guard (`window/checks/finish.ts:25`,
`e2e-notes.ts:104`) are unaffected — the defect is the inconsistency with `runCommand()`, which nulls
the code on expiry.

### The focus `finally` restores the raw capture, bypassing the guard — Medium (`13-e2e.md`)

Every suite captures with raw `captureFrontmost()` and restores that name in `finally`, while
`guardFocus()` separately decides a *safe* target (refusing `crust-e2e`/`crust-app`, scratch paths,
windowless processes). On a normal return the `finally` wins and re-activates whatever was raw-captured,
so the cascade guard is only in force on the signal path. My own mistake in `fad507e`, not the lane's.

## Pending validation

- `04-shell-sidecar.md` — env denylist misses `PYTHONPATH`/`GIT_SSH_COMMAND`
- `06-i18n-downloads-crash.md` — `crash-reporter.configure` accepts a symlinked directory
- `09-linux.md` — two concurrent `dialog.openPanel` invokes share one C slot
- `10-packaging.md` — `crust sign` never re-signs sidecars
- `12-release-ci.md` — re-running a published tag forces it back to draft

## Refuted

(none yet)
