# Publishing

`bun add crust` gives a user one tarball, so the tarball is the contract. The repo is not: `files` in `package.json` decides which bytes travel, `bin` names a file that has to exist inside the tarball, and `exports` maps specifiers to paths that have to resolve without this checkout's `tsconfig.json` beside them. Everything here was read out of a packed tarball, not off a working tree.

## What ships

`files` is `src`, `templates`, `docs`, `README.md`, `DESIGN.md` and `tsconfig.json`, with `!src/**/*.test.ts` excluded; `package.json` is always included. That is 78 files, 47 of them TypeScript source, and 184.1 KiB at `0.1.5` — a tarball small enough that nobody notices a file missing from it until an install fails, which is why it is packed and installed on every change rather than eyeballed. (At `0.1.0` it was 47 source files and 162.2 KiB.)

| Path | Ships | Why |
| --- | --- | --- |
| `src/` | yes | the framework, the CLI, and the `.c` shim sources the runtime compiles at launch |
| `templates/{default,react,next}/` | yes | `crust init` copies real files, so a missing template is a failed scaffold |
| `README.md`, `DESIGN.md` | yes | named in `files` |
| `docs/*.md` | yes | `README.md` links into them, so an absent `docs/` is a set of dead links in an install |
| `tsconfig.json` | yes | `paths` defines the `@/…` alias that 16 shipped files import through; an install without it cannot start |
| `src/**/*.test.ts` | no | inert in an install, and the suite lives in the repo |
| `research/`, `examples/`, `spike/` | no | recon and probes; deliberately left out |
| `node_modules/`, `.crust/`, `.git/` | no | never packed, asserted so a stray `.npmignore` cannot change that |

## Verifying a package

```sh
bun scripts/verify-package.ts          # pack, unpack, install, check, clean up
bun scripts/verify-package.ts --keep   # leave the workspace for inspection
```

Three phases, in the order a user meets them:

1. **pack** — `bun pm pack` into a temp dir. `files` is the only input, so the working tree cannot mask a missing file.
2. **unpack** — read the received copy alone: the manifest's own `bin` and `exports`, the mode bits and shebang on the bin target, every template file, every `docs/*.md`, `DESIGN.md`, `README.md`, and the directories that must not travel.
3. **install** — `bun add <tarball>` into an empty project, then the two commands that make it real: `crust --help` (imports every CLI module) and `crust init probe --react` (reads the templates through `crustRoot`). Both run from `node_modules`, never from this checkout.

One `PASS`/`FAIL` line per assertion, a verdict line with the tarball size, and a non-zero exit on any gap. A passing `--help` is the load-bearing check: a specifier that only resolves inside this repo fails there instead of in the user's first command.

The script runs as `bun run verify:package`. It is in CI: `.github/workflows/ci.yml` runs it on every push to `main` and every pull request, in the `verify package` step, ahead of the standalone build and the e2e suites.

## What it found, and what closed it

The first run of `verify-package` on `0.1.0` failed 7 of 32 checks, and every install-phase failure traced to one defect. Both are fixed; the account stays because the failure mode is the reason the script exists.

**`docs/` was not shipped.** Every `docs/*.md` was missing, and `README.md` links into `docs/`, so every one of those links was dead in an installed package.

**The package could not load itself.** 15 of its 57 shipped TypeScript files import through the `@/…` alias, which resolves only through `paths` in `tsconfig.json` — and `tsconfig.json` was not in `files`. An installed copy therefore failed before it started:

```
crust --help          → Cannot find module '@/config' from …/crust/src/cli/build.ts
import "crust"        → Cannot find module '@/bridge/errors' from …/crust/src/app.ts
import "crust/plugin" → OK
import "crust/vite"   → OK
```

The two `exports` entries that worked were the two subtrees with no alias imports; the plugin and vite modules never pull in `app.ts`, `config` or the bridge. So the failure was not "the package is broken everywhere", it was "every path that reaches the runtime is broken", which is to say all of them.

Closed by shipping `tsconfig.json` — one line in `files` — which was measured before the edit: copying it into `node_modules/crust/` made `crust --help` print its usage and `import "crust"` return the app exports. The alternative, rewriting `@/x` to relative imports, removes the dependency on the alias ever travelling; it was not taken because the alias is 16 files wide and the config is one line. The script now reads the shipped files for alias imports, so an install that carries one without its `paths` fails the check.

`verify-package` passes 32 of 32 at `0.1.5`, tarball 184.1 KiB (162.2 KiB at `0.1.1`).

## Shipping crust as one binary

`bun build --compile --asset=<path>` embeds files in the executable and Bun exposes them both as `Bun.embeddedFiles` and at `/$bunfs/root/<path>`. `src/cli/assets.ts` reads disk first and falls back to the embedded copy, so the same code serves a checkout and a binary, and `crustRoot` finds the package root by looking for `templates/` instead of counting `..`.

Measured with stable Bun 1.4.4, from the repo root:

```sh
bun run build:standalone     # compiles dist/crust, then proves it with no checkout
```

It writes `dist/crust` (89,952,482 bytes) using the flags below, then runs the binary with `PATH=/usr/bin:/bin` from a temporary directory: `--version` must equal `package.json`, `init` must write every file of all three scaffolds, and `doctor` must reach the shim, the templates and the platform from inside the executable. Any gap exits non-zero.

```sh
bun build --compile --outfile dist/crust src/cli/index.ts \
  --asset=src --asset=templates --asset=docs --asset=tsconfig.json --asset=package.json
```

`--asset=src` is the flag that makes `dev` and `build` work at all: their generated entry imports the framework's own sources, and a child `bun build` cannot read a path inside another executable, so the tree is materialised into `$TMPDIR/crust-framework-<version>` first. `--asset=src/platform/darwin` alone would embed only the C shims.

Verified end to end from a compiled crust with no checkout: `crust build` on `examples/hello` produced an 85.25 MiB binary and an 85.26 MiB signed bundle, and that bundle ran with the bridge bound, a 900×640 window open, and both the page's `greet` and a plugin command answered.

Two embedding shapes are not symmetric, which cost an hour: `--asset=<dir>` keeps the directory's own name and everything below it (`--asset=src/platform/darwin` yields `darwin/shim.c`, not `src/platform/darwin/shim.c`), while `--asset=<file>` keeps only the basename. A lookup therefore falls back to the basename, and only when exactly one embedded file carries it.

**Neither `dev` nor `build` needs a checkout any more.** The entry they generate imports the framework's own sources (`src/runtime.ts`, `src/single.ts`) at absolute paths, and a child `bun build` cannot read a path inside another executable, so the embedded tree is materialised into `$TMPDIR/crust-framework-<version>` first (`src/cli/framework.ts`). `dev` is proven from a compiled binary on a bare `PATH` (`/usr/bin:/bin`), in both the single-file and project shapes, by `bun run e2e:dev:binary`. `build` reads that same tree and was measured end to end from a compiled crust (above), but `buildApp` still spawns `bun build --compile` (`src/packaging/build.ts`), so it needs a `bun` on `PATH` — which the Homebrew formula guarantees and a bare standalone binary does not.

**AOT**, measured on canary 1.4.5 (`bun compile` is `bun build --compile --aot`):

| build | size | startup (60 runs) |
| --- | --- | --- |
| `bun compile` | 56.1 MB | 12.5 ms |
| `bun compile --trim` | 38.2 MB | 10.6 ms |
| `--no-aot` | 136.3 MB | 10.8 ms |

AOT is not faster — a 300M-iteration loop ran 215.2 ms against 211.9 ms, so no-aot won by 1.5%, and JSC's JIT out-optimises the ahead-of-time output on this workload. Its value is size and memory, 2.4× smaller and 3.6× with `--trim`. One caveat decides crust's use of it: AOT refuses `import()` from disk (`Cannot load …: it isn't in this executable`), and crust loads the user's `crust.config.ts`, so `--aot-allow-code-from-disk` is mandatory — 3.9 MB, and then AOT's size advantage narrows.

## Reading a stale copy

`bunx github:JeffreyJYZ/crust` caches its resolution under a hash of the specifier, so a bare spec can keep serving the commit it first resolved — a command added on `main` then reports `crust: unknown option`. Two cache directories are involved and both are safe to delete: `~/.bun/install/cache/@GH@JeffreyJYZ-crust-*` (the resolved git package) and `~/.bun/install/cache/.bunx-501/crust@github@*` (the bunx install of it). Naming a ref (`#main`, or a commit) is a different specifier and therefore a new cache entry the first time; it goes stale the same way afterwards, which is why `#main` on this machine still answers `0.1.0` while fresh resolves `main`'s head. The durable fix is publishing to npm, where a version is a version.

## The scaffold's dependency pin

`crust init` writes `link:<dir>` when crust's own directory has a `.git`, and `github:JeffreyJYZ/crust` otherwise. An installed package has no `.git`, so a scaffold made from the tarball names the GitHub repo instead of the registry — correct while `crust` is unpublished, and worth re-reading the moment it is, because a scaffold should then pin `^<version>` like any other dependency. The script asserts only the property that matters here: the pin is not a `link:` or `file:` path inside `node_modules`, which would work until a cache prune and then fail to install.

All three templates ship a `gitignore`, renamed to `.gitignore` on copy — npm renames a nested `.gitignore` when packing, so the template keeps it under the plain name. The script asserts the rename happened rather than the file merely existing, because a scaffold without one commits `node_modules` on the user's first `git add`.

## When you change `files` or `exports`

Run `bun scripts/verify-package.ts` — a new `exports` entry is picked up from the manifest automatically, so it is checked the moment it is added.

A new template directory is the one thing that needs the script too: it walks `default`, `react` and `next` by name, and a fourth template added to `templates/` without a line here would ship unverified. Add its name to the list rather than widening the check to every directory — the point is to assert the templates a user is offered, and a new template that `crust init` cannot select yet is exactly the case worth a deliberate edit.

## Cutting a release

```sh
bun run release --patch --dry    # print the plan, change nothing
bun run release --patch          # 0.1.7 -> 0.1.8, tag, tap PR
```

One command, because the mechanical steps are where this project's release mistakes happened: a tag pushed before the version bump (`v0.1.2` pointed at a tree that still said `0.1.1`), a formula pinned to a tag older than the fixes it advertised, and three PRs for one afternoon of work.

It refuses to start on a dirty tree or off `main`, runs `bun check` and the unit suite, bumps `package.json` and every `#vX` install pin, commits, tags, pushes `main` and the tag, computes the tarball's sha256 from the tag archive (retrying while GitHub serves it), then moves the formula in the tap clone, pushes a `crust-<version>` branch and opens the PR. It never merges: the tap's `main` is protected and the review is the point.

`CRUST_TAP` overrides the tap clone's path. The e2e suites are not run here — they need a desktop session and minutes; run them by hand before releasing, and CI runs them on the PR.

## Publishing itself

Nothing in this repo publishes. `npm publish` needs the account's second factor, so it is a human step: bump the version, run the verifier, publish, then `bun add crust@<version>` in an empty directory and confirm `crust --help` prints its usage. That last command is the same assertion the script makes before a publish; after one, it is the only thing that proves the registry copy and the tarball are the same package.
