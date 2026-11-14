# Install

Three ways to get crust, what each one puts on your machine, what to check when it does not work, and the limits that decide whether your app can ship at all. Every command and every number below was run on macOS 27.0.1 (arm64) on 2026-11-13 against **crust 0.1.8**, except the two `crust doctor` lines that exist only on `main` past the tag, which are marked, and the stale-cache measurements, which are labelled with the version they answered; the packed-install row in the last section is [publishing.md](publishing.md)'s measurement.

Nothing here installs a compiler or a native artifact. crust is TypeScript that Bun runs, and the macOS half is C source compiled at launch by the TinyCC inside Bun; `cc()` executes no compiler binary, so there is no Xcode build and no bottle to match to your machine.

## Before you start

- **macOS 13 (Ventura) or later, Apple silicon.** The shim links AppKit, WebKit and Foundation by name, and there is no Intel, Windows or Linux path. The Homebrew formula declares `depends_on macos: :ventura` for exactly this.
- **Bun.** The formula installs it as a dependency; the other two paths need it already (`bun --version`).
- **Nothing else — no Xcode, no command line tools, no macOS SDK.** The formula's caveat asks for `xcode-select --install` ("crust builds and signs macOS apps, so it needs the Xcode command line tools"). Measured, that requirement does not apply: `src/platform/darwin/*.c` contains no `#include` at all — every Objective-C symbol is a hand-written `extern` — and the shim compiles with an empty environment, `PATH` holding only `bun`, and `SDKROOT=/nonexistent/sdk`. So there are no headers to resolve, no `clang` to find and no SDK to match.

## Homebrew

```sh
brew install JeffreyJYZ/tap/crust
crust --version                 # 0.1.8
```

The formula lives at `Formula/crust.rb` on `main` of [JeffreyJYZ/homebrew-tap](https://github.com/JeffreyJYZ/homebrew-tap), merged 2026-11-13. Installed from that tap on this machine: **`crust 0.1.8`, 97 files, 695.4 KiB (712,102 bytes)**, with `bun` pulled in as a dependency.

What lands where:

| path | what it is |
| --- | --- |
| `/opt/homebrew/Cellar/crust/0.1.8/libexec/` | `src/`, `templates/`, `docs/`, `package.json`, `tsconfig.json`, `DESIGN.md` — the tree crust resolves its templates, its docs and the shim against, so the layout has to stay intact |
| `/opt/homebrew/Cellar/crust/0.1.8/README.md` | the formula lists `README.md` in `libexec.install`, and Homebrew's metafile pass moves it to the keg root (the root had no README of its own), so `libexec/README.md` does not exist. crust reads neither |
| `/opt/homebrew/bin/crust` | a wrapper that execs the brewed `bun` on `libexec/src/cli/index.ts` |
| `bun` | a formula dependency, not vendored |

`research/` and `examples/` are deliberately not installed: recon and scratch, neither of which a user reads or runs.

The install compiles nothing. The shim is compiled by `cc()` the first time something needs it — `crust dev`, `crust build`, or `crust doctor` — and it compiles *from the Cellar*, which is the check that the layout is complete rather than merely present. `crust init` writes into an empty directory and refuses anything else (exit 1, naming the entries it found), so make one first:

```sh
mkdir my-app && cd my-app
crust init . --next
crust doctor
```

```
crust doctor — /private/tmp/my-app
  platform  [ok] darwin arm64
  bun       [ok] 1.4.4 at /opt/homebrew/Cellar/bun/1.4.4_1/bin/bun
  config    [ok] /private/tmp/my-app/crust.config.ts
  macos     [ok] 27.0.1 (no minimumSystemVersion set)
  shim      [ok] /opt/homebrew/Cellar/crust/0.1.8/libexec/src/platform/darwin/shim.c compiles with cc()
  bridge    [ok] http://127.0.0.1:46969 answered "pong" (stable port for app.crust.my-app)
  dev url   [fail] http://localhost:3000 did not answer — is the frontend dev server running?
  backend   [ok] /private/tmp/my-app/main.ts
  window    [ok] platform module loaded, 54 preflight entries
  assets    [fail] build.assets "out" (/private/tmp/my-app/out) is missing — run the frontend build (`bun --bun ./node_modules/.bin/next build`) then crust build; a build now embeds no page
  templates [ok] /opt/homebrew/Cellar/crust/0.1.8/libexec/templates holds default, react, next
  bundle    [note] no .app in dist — run crust build first

2 checks failed
```

That is a `--next` scaffold with nothing built or running: `dev url [fail]` is the check being right, because `http://localhost:3000` is `next dev` and it has not started; `assets [fail]` is the missing `out/` that `next build` produces, and `next build` needs the scaffold's own `bun install` first; `bundle [note]` is the build you have not run. `2 checks failed` is the summary line, and `crust doctor` exits 1 with it. On a plain scaffold — no `dev.url`, `public/` present — the `dev url` and `assets` lines disappear and the run ends `all checks passed`, exit 0.

`main` is past the tag the formula installs, and it prints two lines the keg above does not. **`dev port`** classifies the port `dev.url` names, before `dev url`: `[ok]` when nothing holds it, `[note]` when a process holds it and answers — an existing dev server you left open is fine — `[fail]` when a process holds it and answers nothing, because a `strictPort` server then will not start and the run would wait for a page nothing serves, and `[note]` when the URL answers while nothing listens locally, which means a proxy or a remote host. **`dev watch`** names page-side `.ts` modules the backend watcher will treat as backend code; a fresh `--next` scaffold has none — its only `.ts` files are the entry `main.ts` and `crust.config.ts`, both excluded — so the line is absent until a page module is one. Adding `app/helper.ts` to the scaffold above produces:

```
  dev port  [ok] port 3000 is free for http://localhost:3000
  dev watch [note] 1 page-side .ts file (app/helper.ts) — the watcher skips .tsx/.jsx/.css but not .ts, so saving one restarts the backend and rotates the bridge token; rename them .tsx, or move them under a skipped directory such as public/
```

Both lines describe `crust dev` behaviour that used to fail silently. The window loads `dev.url` exactly once and cannot retry, so `crust dev` waits up to 30 s for it to accept a TCP connection before starting the runtime — a cold Vite start takes 0.7–1.1 s while the window appears at 0.2–0.4 s, and without the wait the load went into a closed port and the page never rendered. And on a `dev.url` project, saving a `.tsx`, `.jsx`, `.css`, `.scss`, `.sass`, `.less`, `.html` or image file no longer restarts the backend; the dev server owns those, and a restart rotated the bridge token, so the page already open started failing its calls. `.ts` and `.js` still restart it, because the backend entry is one of them — which is the trap `dev watch` names.

Upgrade with `brew upgrade crust`; remove with `brew uninstall crust`. The formula installs no service and writes nothing outside the Cellar and the `bin` symlink.

**The formula tracks the newest tag, not `main`.** It downloads `refs/tags/v0.1.8`, so a brewed `crust` is exactly that release — commit `57555eb` — and `main` is past it, which is why the two `crust doctor` lines above are not in a brewed 0.1.8. The tap moved fast in this release cycle — eight tags, v0.1.1 through v0.1.8, all created on 2026-11-13 between 13:30 and 19:45 — so treat the version and the file counts above as a measurement rather than a promise: `crust --version` and `brew list --versions crust` are the checks, and `brew update && brew upgrade crust` moves a stale keg.

That tag matters for the scaffold you get. Template sizes differ between releases: the Next template is **8 files at 0.1.2 and later** and **7 at 0.1.1 and earlier** — the missing file is `tsconfig.json`, which the Next scaffold gained in 0.1.2, so an older Next scaffold has no `@/` path alias; the plain and React templates are 7 at every release. And the version string is not always a tell, because `main` can carry the same version as the tag it sits past. Measured today: the tag `v0.1.8` is commit `57555eb`, and a `github:` scaffold resolved `main`'s head to a later commit; both reported `0.1.8` and both hold an 8-file Next template. A brewed scaffold is the tag's; an app it scaffolds pins `github:JeffreyJYZ/crust` and `bun install` resolves `main`, so the app's copy and the CLI that made it can be different commits at the same version. When a difference matters, compare the resolved commit, not the number — the app's `bun.lock` records the copy it runs as `crust@github:JeffreyJYZ/crust#<commit>`, and `git -C <checkout> rev-parse --short v0.1.8` reads the tag.

## bunx, with nothing installed

```sh
bunx github:JeffreyJYZ/crust#v0.1.11 init my-app
```

`bunx` is `bun x`: it resolves the specifier, caches the result, and runs `bin/crust` out of it. Nothing is added to your `PATH`, and nothing needs to be, which is why this is the fastest way to try crust. Note the tag. A bare `github:JeffreyJYZ/crust` names no version at all — it means "whatever this machine's cache already resolved" — so the same page gives different readers different crust:

| specifier | fresh cache | this machine's existing cache |
| --- | --- | --- |
| `github:JeffreyJYZ/crust` | `main`'s head, `0.1.8`, Next template 8 files | `0.1.0`, and `--next` refused |
| `github:JeffreyJYZ/crust#main` | `main`'s head, `0.1.8` | `0.1.0`, Next template 7 files |
| `github:JeffreyJYZ/crust#v0.1.11` | `0.1.11`, 8 files | `0.1.11`, 8 files |

**The trap is the cache, and it is not a bug in crust.** bunx keys its cache on the specifier string, so a bare `github:JeffreyJYZ/crust` keeps serving whatever commit it first resolved, indefinitely. A reader whose cache predates a feature sees a command fail for a reason that has nothing to do with the code they are running:

```
$ bunx github:JeffreyJYZ/crust init my-app --next
crust: unknown option --next
run "crust --help" for usage
```

Measured on this machine, twice, before touching the cache: `0.1.0` from both the bare and the `#main` specifier. The version string is still not the tell — those two answers are *different 0.1.0 commits*, and one of them has `--next` while the other does not. `#main` is a moving name with a frozen cache entry in front of it, so it fixes nothing.

Two cures, in order of preference:

1. **Name a tag.** A different specifier is a different cache key, so `bunx github:JeffreyJYZ/crust#v0.1.11 init my-app --next` resolves fresh the first time and answers `0.1.11` with the 8-file Next template. A tag is the one ref whose answer cannot drift, because the commit it names does not move (a re-tagged release is the only way it could).
2. **Clear the two cache directories.** Both are safe to delete, nothing else lives in them:

```sh
rm -rf ~/.bun/install/cache/.bunx-501/crust@github@*
rm -rf ~/.bun/install/cache/@GH@JeffreyJYZ-crust-*
```

The first is the bunx install of the specifier, the second the resolved git package. The durable fix is a registry release, where a version is a version.

## From a checkout

```sh
git clone https://github.com/JeffreyJYZ/crust
cd crust
bun install                     # two dev dependencies: @types/bun and vite
bun run start init my-app       # `start` is `bun run src/cli/index.ts`
```

`bun run start` takes every command and flag the `crust` binary does, so `bun run start dev --dir examples/hello` runs the bundled example and `bun run start --help` prints the usage. `bun src/cli/index.ts …` is the same thing without the script. The `vite` dev dependency is there for `src/vite.ts`, the Vite plugin crust exports (`crust/vite`), not for any crust command.

Two examples run from a checkout: `examples/hello`, the plain app with no `package.json` and nothing to install, and `examples/dogear`, a notes app on Vite with an editor, a tray menu and a window title that follows the current note. Dogear needs `bun install` in its own directory first, because its `beforeDevCommand` runs Vite from its `node_modules`; then `bun run start dev --dir examples/dogear`, or `DOGEAR_SELFCHECK=1 bun run start dev --dir examples/dogear` to make the page run its own eleven-step check and print `PASS`/`FAIL` per step.

A scaffold made from a checkout pins its `crust` dependency as `link:<checkout>` — absolute, as measured: `"crust": "link:/private/var/folders/…/crust-measure2/checkout"` — so an edit under `src/` is picked up by the app without republishing. Every other install pins `github:JeffreyJYZ/crust`.

## What the app runs, versus what you ran

`crust init` writes `crust` into the scaffold's `package.json`, and `bun install` puts a copy in `node_modules/`, with its `bin` linked as `node_modules/.bin/crust`, a symlink pointing at `../crust/src/cli/index.ts`. Inside the project, `bunx crust` resolves through that local `bin` — bun prefers a local install — so **the app runs the copy it pinned**, not the CLI you used to scaffold it. Measured on a scaffold made by brew's 0.1.8, which pins `github:JeffreyJYZ/crust`:

```
$ bun install
+ crust@github:JeffreyJYZ/crust#888de0e
$ bunx crust --version
0.1.8
```

Both copies report `0.1.8` here, so the version is not the tell — the resolved commit is. The brew CLI is the tag's `57555eb`; the app's copy was `main`'s `888de0e` when measured, and the app's `bun.lock` records it as the `crust@github:JeffreyJYZ/crust#<commit>` entry. The local copy won the `bunx` lookup, and that is provable rather than inferred: pointing a checkout scaffold's `link:` package at `9.9.9` made `bunx crust --version` print `9.9.9` inside the app while `/opt/homebrew/bin/crust --version` still printed the brew CLI's own version in the same shell.

So there are two installations, and a bug in one is not a bug in the other. When an app behaves differently from the CLI you scaffolded it with, `bunx crust --version` and `crust --version` inside the same directory is the first thing to run.

## Limits

These five decide what you can build; all are stated in [README.md](../README.md#limits-stated-plainly) with their measurements.

- **macOS 13+ on Apple silicon.** Intel, Windows and Linux are not supported.
- **~85 MiB per built app.** Bun ships its runtime inside the binary. That is the framework's floor, not your code: three thousand extra functions moved it 161 KiB.
- **Ad-hoc signing.** `codesign --sign -` opens on this machine and Gatekeeper refuses it on any other, so a recipient needs `xattr -dr com.apple.quarantine "my-app.app"` or right-click → Open. `crust sign` is the Developer ID path and needs a certificate this repository does not ship.
- **`notification` is refused inside a bundle.** The call is entered, `UNUserNotificationCenter` answers, and the callback fires with `granted = false`. Cause narrowed, not identified; no fake success is reported.
- **Next.js means static export.** One binary, no server: route handlers, middleware, ISR, `next/image` optimisation, Server Actions and request-time `cookies()`/`headers()` are out of scope. [next.md](next.md) is the full list.

## When it does not work

| symptom | cause | fix |
| --- | --- | --- |
| `crust: unknown option --next` (or any newer flag) | a stale bunx cache serving an older commit | name a tag, or delete the two cache directories above |
| `brew install` says there is no formula | your tap copy was cloned before the formula landed on `main` | `brew update` |
| a scaffold has 7 files where the docs say 8 | you are on 0.1.1 or older, whose Next template has no `tsconfig.json`, or a stale bunx cache served it | check `crust --version`; name `#v0.1.11` |
| `Cannot find module '@/config'` from a packed install | a 0.1.0-era tarball shipped without the `tsconfig.json` that defines the `@/` alias | reinstall at 0.1.1 or later |
| `dev url [fail]` in `crust doctor` | the frontend dev server is not running, or is on another port | start it (`bun run dev`), and keep the port pinned — the bridge allows exactly the origin `dev.url` names |
| `dev port [fail]` in `crust doctor` (on `main` past v0.1.8) | a process holds the port `dev.url` names and answers nothing on it, so a `strictPort` dev server cannot start and the run would wait 30 s for a page nothing serves | free that port, or point `dev.url` at a free one |
| `dev watch [note]` naming page-side `.ts` files (on `main` past v0.1.8) | the backend watcher skips `.tsx`, `.jsx`, `.css` and other frontend files but not `.ts`, so saving one restarts the runtime and rotates the bridge token | rename the module to `.tsx`, or move it under a skipped directory such as `public/` |
| `assets [fail]` in `crust doctor` on a `--next` scaffold | `out/` does not exist yet | `bun install && bun --bun ./node_modules/.bin/next build`, then `crust build` |
| the app opens here, "is damaged" on another Mac | ad-hoc signature plus the quarantine attribute | `xattr -dr com.apple.quarantine "my-app.app"`, or right-click → Open |
| `notification` reports `delivered: false` | known; inside a bundle the authorization answer is denied, and unbundled there is no bundle identifier to notify from | nothing to configure yet — see [README.md](../README.md#limits-stated-plainly) |
| a built app is 85 MiB and you expected less | the Bun runtime, inside the binary | nothing; the honest claim is "no bundled Chromium", never "as small as Tauri" |

`crust doctor` is the first command to run for any of these: it checks the platform, Bun, the config, the macOS version, the shim compiling, the bridge binding and answering, the dev port, the dev URL, the backend entry, the page-side `.ts` modules the watcher would treat as backend code, the window module, the assets directory, the templates and the bundle, and it prints one line per check.

## Where to go next

- [README.md](../README.md#start-an-app) — pick a scaffold, or run one file with no scaffold at all.
- [api.md](api.md) — the config surface, the app surface, and every error shape.
- [plugins.md](plugins.md) — the five built-in plugins, and how to mount your own.
- [single-file.md](single-file.md) — `crust dev app.tsx`, and what it deliberately lacks.
- [next.md](next.md) — the Next.js static-export path, with what was run.
