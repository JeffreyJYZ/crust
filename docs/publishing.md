# Publishing

`bun add crust` gives a user one tarball, so the tarball is the contract. The repo is not: `files` in `package.json` decides which bytes travel, `bin` names a file that has to exist inside the tarball, and `exports` maps specifiers to paths that have to resolve without this checkout's `tsconfig.json` beside them. Everything here was read out of a packed tarball, not off a working tree.

## What ships

`files` is `src`, `templates`, `docs`, `README.md`, `DESIGN.md` and `tsconfig.json`, with `!src/**/*.test.ts` excluded; `package.json` is always included. That is 47 source files and 162.2 KiB at `0.1.0` — a tarball small enough that nobody notices a file missing from it until an install fails, which is why it is packed and installed on every change rather than eyeballed.

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

The script runs as `bun run verify:package`. It is not in CI yet — no `.github/workflows/` exists — but nothing in it is macOS-specific (`tar`, `bun pm pack`, `bun add` and a temp directory), so a workflow step would work as it stands.

## What it found on 2026-11-13

Two gaps, both reproducible from the tarball, neither fixed by the lane that found them because both need `package.json`, which that lane did not own.

**`docs/` is not shipped.** Every `docs/*.md` is missing — the 8 pages present on 2026-11-13, this one included. `README.md` links into `docs/`, so every one of those links is dead in an installed package. Fix: add `"docs"` to `files`.

**The package cannot load itself.** 15 of its 57 shipped TypeScript files import through the `@/…` alias, which resolves only through `paths` in `tsconfig.json` — and `tsconfig.json` is not in `files`. The installed package therefore fails before it starts:

```
crust --help                                  → Cannot find module '@/config' from …/crust/src/cli/build.ts
import "crust"                                → Cannot find module '@/bridge/errors' from …/crust/src/app.ts
import "crust/plugin"                         → OK
import "crust/vite"                           → OK
```

The two `exports` entries that work are the two subtrees with no alias imports; the plugin and vite modules never pull in `app.ts`, `config` or the bridge. So the failure is not "the package is broken everywhere", it is "every path that reaches the runtime is broken", which is to say all of them.

Both fixes were measured rather than assumed:

- **Ship `tsconfig.json`.** Copying it into `node_modules/crust/` makes `crust --help` print its usage and `import "crust"` return the app exports. One line in `files`.
- **Rewrite `@/x` to a relative import.** No config needed at all, and no chance of the alias and the tarball drifting apart again. Larger diff, and `bun check` catches a mistake immediately.

Either way the assertion already exists: the script reads the shipped files for alias imports and refuses to pass while the alias ships without its `paths`.

## Reading a stale copy

`bunx github:JeffreyJYZ/crust` caches its resolution under a hash of the specifier, so a bare spec can keep serving the commit it first resolved — a command added on `main` then reports `crust: unknown option`. Two cache directories are involved and both are safe to delete: `~/.bun/install/cache/@GH@JeffreyJYZ-crust-*` (the resolved git package) and `~/.bun/install/cache/.bunx-501/crust@github@*` (the bunx install of it). Naming a ref (`#main`, or a commit) is a different specifier and resolves fresh; it goes stale the same way afterwards. The durable fix is publishing to npm, where a version is a version.

## The scaffold's dependency pin

`crust init` writes `link:<dir>` when crust's own directory has a `.git`, and `github:JeffreyJYZ/crust` otherwise. An installed package has no `.git`, so a scaffold made from the tarball names the GitHub repo instead of the registry — correct while `crust` is unpublished, and worth re-reading the moment it is, because a scaffold should then pin `^<version>` like any other dependency. The script asserts only the property that matters here: the pin is not a `link:` or `file:` path inside `node_modules`, which would work until a cache prune and then fail to install.

`templates/react` also ships no `gitignore` (the other two do), so an app scaffolded with `--react` has no `.gitignore` and will happily commit `node_modules` and `dist`. The script notes it rather than failing, because a template's contents are not a package boundary.

## When you change `files` or `exports`

Run `bun scripts/verify-package.ts` — a new `exports` entry is picked up from the manifest automatically, so it is checked the moment it is added.

A new template directory is the one thing that needs the script too: it walks `default`, `react` and `next` by name, and a fourth template added to `templates/` without a line here would ship unverified. Add its name to the list rather than widening the check to every directory — the point is to assert the templates a user is offered, and a new template that `crust init` cannot select yet is exactly the case worth a deliberate edit.

## Publishing itself

Nothing in this repo publishes. `npm publish` needs the account's second factor, so it is a human step: bump the version, run the verifier, publish, then `bun add crust@<version>` in an empty directory and confirm `crust --help` prints its usage. That last command is the same assertion the script makes before a publish; after one, it is the only thing that proves the registry copy and the tarball are the same package.
