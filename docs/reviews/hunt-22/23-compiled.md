# compiled / single-file — read-only defect hunt

Scope: `bun build --compile`, `$bunfs` handling, generated wrappers, asset embedding and resolution,
single-file build/dev. No source files changed. Tree at review: `2174a6d`
(`docs(install): re-measure the tag for 0.2.18`), clean worktree.

## Findings

### 1. Medium — a config-based compiled app still serves files from `<launch cwd>/public`

`src/cli/build/wrapper.ts:65-70`, `src/runtime.ts:47-48,93-94,113-117`,
`src/bridge/server/assets.ts:42-58`

The generated entry for a project build passes `config`, `assets` and `entryModule` to `startApp`,
but no `root`:

```ts
await startApp({
	config: production,
	assets,
	entryModule: () => import("/p/main.ts"),
});
```

`startApp` therefore computes `projectDir = process.cwd()` (no `configPath` was passed either) and
`root = join(projectDir, "public")`. When that directory exists, `frontendRoot` is set and
`assetBody` falls through to `Bun.file(resolve(root, relative))` for every path not present in the
embedded asset table.

The single-file wrapper already treats this as a defect to prevent: it defines
`NO_PROJECT_ROOT = "/crust-single/no-project"` (`wrapper.ts:81`) and passes it explicitly
(`wrapper.ts:107`). The e2e single-file phase launches the built binary with `cwd: "/"`
(`scripts/single/phases/build.ts:63-72`) precisely so a disk fallback cannot satisfy the test.
Config-based builds have neither guard.

Measured with a probe against the shipped code:

```
project wrapper passes root: false
single wrapper root line: root: "/crust-single/no-project",
assetBody served disk file: true
```

Reach: every `crust build` on a project with a config, on every platform. On macOS a bundle
normally gets cwd `/`, so `/public` rarely exists; on Linux and Windows the flat binary is launched
from wherever the user or shell puts it, so a real `public/` beside it is served. Consequences:
a shipped binary's page can fetch files that were never embedded, and the app's behaviour changes
with its launch directory. This contradicts the packaging guide
(`site/app/docs/guides/package/page.mdx:33-35`: "Whatever the directory holds is embedded in the
binary — there is no server at run time"). `src/cli/build/wrapper.test.ts:45-51` pins the current
byte-for-byte output, so the omission is enshrined by a test.

Fix direction (not applied): pass the same no-project sentinel from `wrapperSource`, or make
`startApp` treat `assets !== undefined && configPath === undefined` as "no disk root".

### 2. Low — `frameworkRoot()` trusts a predictable, shared temp directory

`src/cli/framework.ts:42-70`

```ts
const target = join(tmpdir(), `crust-framework-${VERSION}`);
const marker = join(target, ".complete");
if (await exists(marker)) {
	cached = target;
	return target;
}
```

The path is derived only from the version. If anything has already created
`$TMPDIR/crust-framework-<version>/.complete`, the function returns it without checking a single
file inside: no owner check, no content hash, no verification that `src/runtime.ts` is the one this
binary carries. `Bun.write` follows symlinks, so a symlinked `target` is written through as well.

Reach: compiled `crust build app.tsx` (`src/cli/build/single-app.ts:54`) and compiled
`crust dev app.tsx` (`src/cli/dev/single.ts:26`) resolve `frameworkRoot()` and then import
`src/index.ts`, `src/runtime.ts`, `src/single.ts` and the crash guard from that directory into the
generated entry. A stale tree from an earlier install of the same version, or another local user on
a shared host, can supply those modules. Impact: the generated app imports code that did not come
from the executable. On a single-user machine this is mostly a stale-tree risk; on a shared host it
is a local code-injection path.

### 3. Low — asset walk silently drops symlinks

`src/cli/build/assets.ts:41-66`

```ts
if (entry.isDirectory()) { await walk(full, url); continue; }
if (!entry.isFile()) continue;
```

A `Dirent` for a symlink satisfies neither branch, so the entry is skipped without a line of output.
`resolveAssets` has already promised that a named `build.assets` directory was built
(`src/cli/build/resolve-assets.ts:49-81`), and `crust build` prints a file count
(`src/cli/build.ts:97-102`), so a symlinked stylesheet or image disappears from the compiled
binary while the command reports success. Frontend output directories that symlink shared assets
therefore ship an incomplete page. The walk also has no case for readable-but-broken links, which
silently widen the gap between "count reported" and "bytes embedded".

### 4. Low — stale files from an earlier single-file bundle are embedded

`src/single-build.ts:63-124`, `src/cli/build/single-app.ts:43-49`

`buildPage` writes into a persistent directory (`dist/single` for a build, `.crust/single` for dev)
and `Bun.build` does not clean `outdir`; nothing in the module removes it either. `buildSingle` then
embeds the entire directory:

```ts
const assets = await collectAssets(page.dir);
```

A single file that was previously a bundled `.tsx` leaves `dist/single/page.js` behind. Switching
that file to a plain `.html` entry takes the `extname === ".html"` branch, which writes only
`index.html` and skips the bundler, but the old `page.js` still sits in the directory and is
embedded into the shipped binary. The same residue applies to any future output whose name changes.
Impact is bounded — the stale file is served at its old URL rather than executed by the new
document — but the binary contains bytes the current source did not produce, and the reported asset
count includes them.

## Ruled out

- Asset keys always carry a leading `/` (`assets.ts:51`), so an object-literal `__proto__` key
  collision cannot occur in `assetsModuleSource`. Verified: a `/__proto__` asset is an own property.
- `inExecutable()` uses `import.meta.dir.includes("/$bunfs")` (`src/cli/framework.ts:13-15`).
  This repo's Windows sources use the same forward-slash form in their comments, so no platform
  mismatch was established here.
- `readIndex` prefers `assets["/index.html"]` over the disk file (`src/runtime-host.ts:164-172`),
  so the cwd fallback in finding 1 cannot replace the document itself; it only serves other paths.
- The AOT retry in `src/packaging/build.ts:80-97` matches Bun's current wording and falls back
  correctly; no defect claimed without a failing probe.
