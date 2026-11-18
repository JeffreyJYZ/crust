# Lane F4 — sidecars and dev (measured 2026-11-18)

## build.sidecars was never wired
- `src/cli/build.ts` passed `entry`/`binaryName`/`outDir`/`app` to `buildApp` but not `sidecars`/`projectDir`, so `copySidecars` wrote `[]` and copied nothing (`src/packaging/build.ts:112-123`). Fixed by passing `config.build?.sidecars` and `projectDir: options.dir` additively.
- `src/cli/build/single-app.ts:51-61` has the same omission but is not in this lane's owned files — reported, not fixed.
- `src/packaging/build.ts` was re-read immediately before writing; no edit was needed there (it already implements copy + manifest). Another lane edits it for binary size; left untouched.
- Installer side (report §1 second half): NSIS/AppImage package from `<dist>`, not the `.app/Contents/MacOS` where sidecars land — outside owned files, reported.

## `crust dev` died on Svelte/Vue with `document is not defined`
- Root cause: `resolveBackendEntry` (`src/cli/util.ts:89`) picks `src/main.ts` first. In the Svelte/Vue scaffolds `src/main.ts` is the *Vite frontend* entry (imports `svelte`/`vue`, uses `document`); React uses `src/main.tsx`, so its root `main.ts` backend is picked and works.
- Fixed in `src/cli/dev.ts`: new `htmlModuleEntry(dir)` reads the page's `<script type="module" src=…>` from `index.html`; `devBackendEntry(dir, explicit)` skips that path when resolving the backend, so the root `main.ts` is imported instead. Explicit `--entry` still wins.
- Did NOT rename the template frontend files: `scripts/release/template-frameworks.test.ts:69-77` pins `index.html` → `/src/main.ts` and `src/main.ts` for those templates, and that test file is outside this lane's ownership.
- `src/cli/util.ts` and `src/cli/build/single-app.ts` still use the naive resolver — reported, not fixed.

## Wiring exposed a second defect: codesign refused the sidecar
- With sidecars actually copied into `Contents/MacOS`, `codesign --force --sign -` failed the bundle seal: "code object is not signed at all … In subcomponent: …/Contents/MacOS/bin/tool.sh". codesign treats every file there as nested code (the same reason the manifest lives in Resources).
- Fixed additively in `src/cli/build.ts`: each copied sidecar gets `codesign --force --sign - --timestamp=none` before `signApp` seals the bundle. Kept out of `src/packaging/build.ts` (another lane edits it for binary size); that file was re-read before writing and left untouched.

## Proof
- New `src/cli/build-sidecars.test.ts` runs the real CLI build into a temp dir with `build.sidecars: ["bin/tool.sh"]`, then reads the app's `crust-sidecars.json` and checks the copied file and 0755 mode. It went red on codesign before the sidecar-sign fix, green after.
- New `src/cli/dev/backend-entry.test.ts` covers the HTML-name collision, the non-collision case and explicit `--entry`.
- Live dev probe in a temp dir (deleted afterwards), both with `bun install` then `bun run <crust>/src/cli/index.ts dev`: svelte log `window open` + `greet hello svelte (page call answered)`, vue log `window open` + `greet hello vue (page call answered)`; neither printed `document is not defined`. Focus handed back with `open -a Ghostty`; no lingering vite process.
- Gate: `bun check` (764 files, no type errors), `bun run check:lines` PASS, `bun test <narrow path list>` 1591 pass / 0 fail.

## Defect outside this lane, reported not fixed
- F2's `package.json` edit changed `"test"` from narrow paths to `bun test src examples …`. Bun filters by path *substring*, so `src` also matches `research/electrobun/repo/package/src/...` and `bun run test` sweeps the vendored mirror: 46 spurious fails / 35 errors. The prior narrow path list is green. F2 owns `package.json` — needs a path form that cannot substring-match `research/` (e.g. `./src/` anchored patterns or explicit file globs).
