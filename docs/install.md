# Install

Three ways to get crust, what each one puts on your machine, what to check when it does not work, and the limits that decide whether your app can ship at all. Every command and every number below was run on macOS 27.0.1 (arm64) on 2026-11-13, except the packed-install row in the last section, which is [publishing.md](publishing.md)'s measurement.

Nothing here installs a compiler or a native artifact. crust is TypeScript that Bun runs, and the macOS half is C source compiled at launch by the TinyCC inside Bun; `cc()` executes no compiler binary, so there is no Xcode build and no bottle to match to your machine.

## Before you start

- **macOS 13 (Ventura) or later, Apple silicon.** The shim links AppKit, WebKit and Foundation by name, and there is no Intel, Windows or Linux path. The Homebrew formula declares `depends_on macos: :ventura` for exactly this.
- **Bun.** The formula installs it as a dependency; the other two paths need it already (`bun --version`).
- **A macOS SDK.** No compiler runs, but the shim's `#include`s need headers. `xcode-select --install` is where they come from, which is why the formula's caveat asks for it.

## Homebrew

```sh
brew install JeffreyJYZ/tap/crust
crust --version                 # 0.1.1
```

The formula lives at `Formula/crust.rb` on `main` of [JeffreyJYZ/homebrew-tap](https://github.com/JeffreyJYZ/homebrew-tap), merged 2026-11-13. Installed from that tap on this machine: **`crust 0.1.1`, 87 files, 589 KB**, with `bun` pulled in as a dependency.

What lands where:

| path | what it is |
| --- | --- |
| `/opt/homebrew/Cellar/crust/0.1.1/libexec/` | `src/`, `templates/`, `docs/`, `package.json`, `tsconfig.json`, `README.md`, `DESIGN.md` — the tree crust resolves its templates, its docs and the shim against, so the layout has to stay intact |
| `/opt/homebrew/bin/crust` | a wrapper that execs the brewed `bun` on `libexec/src/cli/index.ts` |
| `bun` | a formula dependency, not vendored |

`research/` and `examples/` are deliberately not installed: recon and scratch, neither of which a user reads or runs.

The install compiles nothing. The shim is compiled by `cc()` the first time something needs it — `crust dev`, `crust build`, or `crust doctor` — and it compiles *from the Cellar*, which is the check that the layout is complete rather than merely present. `crust init` writes into an empty directory and refuses anything else, so make one first:

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
  shim      [ok] /opt/homebrew/Cellar/crust/0.1.1/libexec/src/platform/darwin/shim.c compiles with cc()
  bridge    [ok] bound http://127.0.0.1:61587, invoke answered "pong"
  dev url   [fail] http://localhost:3000 did not answer — is the frontend dev server running?
  backend   [ok] /private/tmp/my-app/main.ts
  window    [ok] /opt/homebrew/Cellar/crust/0.1.1/libexec/src/platform/darwin/index.ts
  bundle    [note] no .app in dist — run crust build first

1 check failed
```

That is a `--next` scaffold with nothing running: `dev url [fail]` is the check being right, because `http://localhost:3000` is `next dev` and it has not started; `bundle [note]` is the build you have not run, and `1 check failed` is the exit code that follows from the first. On a scaffold with no `dev.url` both lines disappear and the run ends `all checks passed`, exit 0.

Upgrade with `brew upgrade crust`; remove with `brew uninstall crust`. The formula installs no service and writes nothing outside the Cellar and the `bin` symlink.

**The formula tracks the tag, not `main`.** It downloads `refs/tags/v0.1.1`, so a scaffold made with a brewed `crust` is the tag's template, not `main`'s — the Next template is the worked example, seven files at 0.1.1 and eight on `main`. The version string does not distinguish the two (both report `0.1.1`), so compare the scaffold you get, or `crust --help`, against the repo when a difference matters.

## bunx, with nothing installed

```sh
bunx github:JeffreyJYZ/crust init my-app
```

`bunx` is `bun x`: it resolves the specifier, caches the result, and runs `bin/crust` out of it. Nothing is added to your `PATH`, and nothing needs to be, which is why this is the fastest way to try crust.

**The trap is the cache, and it is not a bug in crust.** bunx keys its cache on the specifier string, so a bare `github:JeffreyJYZ/crust` keeps serving whatever commit it first resolved, indefinitely. A reader whose cache is older than a feature sees a command fail for a reason that has nothing to do with the code they are running:

```
$ bunx github:JeffreyJYZ/crust init my-app --next
crust: unknown option --next
run "crust --help" for usage
```

Measured on this machine: a bunx cache resolved before `--next` existed answered exactly that, while `github:JeffreyJYZ/crust#v0.1.1` — never used before, so resolved fresh — answered `0.1.1` and scaffolded the template.

Two cures, in order of preference:

1. **Name a ref.** A different specifier is a different cache key, so `bunx github:JeffreyJYZ/crust#main init my-app --next` resolves fresh the first time. It goes stale the same way afterwards: `#main` is a moving name, and this machine's `#main` entry was itself answering `0.1.0` long after `main` had moved on. A tag is the one ref that cannot go stale, because the commit it names does not move.
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
bun install                     # one dev dependency: @types/bun
bun run start init my-app       # `start` is `bun run src/cli/index.ts`
```

`bun run start` takes every command and flag the `crust` binary does, so `bun run start dev --dir examples/hello` runs the bundled example and `bun run start --help` prints the usage. `bun src/cli/index.ts …` is the same thing without the script.

A scaffold made from a checkout pins its `crust` dependency as `link:<checkout>`, so an edit under `src/` is picked up by the app without republishing. Every other install pins `github:JeffreyJYZ/crust`.

## What the app runs, versus what you ran

`crust init` writes `crust` into the scaffold's `package.json`, and `bun install` puts a copy in `node_modules/`, with its `bin` linked as `node_modules/.bin/crust`. Inside the project, `bunx crust dev` resolves through that local `bin` — bun prefers a local install — so **the app runs the copy it pinned**, not the CLI you used to scaffold it. Measured on a scaffold made by brew's 0.1.1, which pins `github:JeffreyJYZ/crust`:

```
$ bun install
+ crust@github:JeffreyJYZ/crust#a27808a
$ bunx crust --version
0.1.1
```

Both copies report `0.1.1` here, so the version is not the tell — the resolved commit is. The point is that they are two installations: the CLI in `/opt/homebrew/bin` and the one in the app's `node_modules` can be different commits, and a bug in one is not a bug in the other.

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
| `Cannot find module '@/config'` from a packed install | a 0.1.0-era tarball shipped without the `tsconfig.json` that defines the `@/` alias | reinstall at 0.1.1 or later |
| `dev url [fail]` in `crust doctor` | the frontend dev server is not running, or is on another port | start it (`bun run dev`), and keep the port pinned — the bridge allows exactly the origin `dev.url` names |
| the app opens here, "is damaged" on another Mac | ad-hoc signature plus the quarantine attribute | `xattr -dr com.apple.quarantine "my-app.app"`, or right-click → Open |
| `notification` reports `delivered: false` | known; inside a bundle the authorization answer is denied, and unbundled there is no bundle identifier to notify from | nothing to configure yet — see [README.md](../README.md#limits-stated-plainly) |
| a built app is 85 MiB and you expected less | the Bun runtime, inside the binary | nothing; the honest claim is "no bundled Chromium", never "as small as Tauri" |

`crust doctor` is the first command to run for any of these: it checks the platform, Bun, the config, the macOS version, the shim compiling, the bridge binding and answering, the dev URL, the backend entry, the window module and the bundle, and it prints one line per check.

## Where to go next

- [README.md](../README.md#start-an-app) — pick a scaffold, or run one file with no scaffold at all.
- [api.md](api.md) — the config surface, the app surface, and every error shape.
- [plugins.md](plugins.md) — the five built-in plugins, and how to mount your own.
- [single-file.md](single-file.md) — `crust dev app.tsx`, and what it deliberately lacks.
- [next.md](next.md) — the Next.js static-export path, with what was run.
