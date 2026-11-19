# hunt-50 · build artefacts that differ from what is claimed (39)

Scope: `src/cli/build.ts`, `src/cli/build/`, `src/cli/build-sidecars.test.ts`, `src/cli/build.test.ts`. Read-only review; every claim below was checked against the source it names, and the first three were reproduced with a local `bun -e` against the working tree.

**Count: 6 findings** (1 high, 3 medium, 2 low). Worst is finding 1.

---

## 1 (worst) — a default `public/` build ships stale frontend bytes despite the explicit "never ships stale" promise

- `src/cli/build/resolve-assets.ts:20` — the function's contract says "`beforeBuildCommand` ... runs first and its non-zero exit aborts, so a framework app never ships whatever sat in its asset directory from an earlier run ... 'exited 0' is not the same fact as 'produced an index.html'".
- `src/cli/build/resolve-assets.ts:40-48` — `built` is set from the command, but the strict block is gated on `if (setting)` (a *named* `build.assets`); with no setting the code falls through to line 83.
- `src/cli/build/resolve-assets.ts:83` — the default path returns `collectAssets(assetsDir)` with **no** `index.html` check.
- `src/cli/build.test.ts:72-84` — the only test for "exited 0 but produced nothing" passes `assets: "web"`, so the named branch is covered and the default branch is not.

The artefact differs from the claim: with `beforeBuildCommand` set and `build.assets` absent, a command that exits 0 without (re)writing `public/index.html` still embeds whatever `public/index.html` was left by an earlier run. The build prints `assets N files from public/` and produces an app whose page is old content, exactly the outcome line 20 says cannot happen. `crust build` never validates the default directory for a document.

Reproduced: temp dir with `public/index.html` = `STALE`, config `build: { beforeBuildCommand: "true" }`, `resolveAssets(dir, cfg, dist)` returned `{ok:true, label:"public", files:["/index.html"], embedded:["STALE"]}`.

Reached: any project that sets `beforeBuildCommand` but omits `build.assets` — the config reference documents the two keys independently (`site/app/docs/reference/config/page.mdx:76-77`) and even says the default `public/` "must hold `index.html`", a check the code never performs on that path. A generator whose output dir changed or whose build silently no-ops hits this on an ordinary rebuild. Fix: apply the `index.html` check to the default `public/` path too whenever `built` is true, not only inside `if (setting)`.

---

## 2 — assets embedded as text are served as `application/octet-stream`, contradicting the "matches CONTENT_TYPES" claim

- `src/cli/build/assets.ts:13-15` — claims "The list matches the bridge's own `CONTENT_TYPES` text half, so what is embedded as text is exactly what is served with a text content type."
- `src/cli/build/assets.ts:16-29` — `TEXT_ASSET_EXTENSIONS` contains `.htm`, `.cjs` and `.xml`, which are absent from `src/bridge/server/http.ts:8-30`.
- `src/bridge/server/http.ts:63-66,34-38` — `contentTypeOf` falls through to `application/octet-stream`, and asset responses carry `X-Content-Type-Options: nosniff`; `src/bridge/server/handler.ts:124-128` uses that exact function for embedded assets.

The list does not match. The three extensions above are stored as strings in `crust-assets.ts` yet answered with an octet-stream MIME type, so the served artefact is not "a text content type". Consequence for a real page: a `<script src="x.cjs">` is refused by the browser under `nosniff`, and an `.xml` asset is not rendered as XML. The served MIME is decided by `contentTypeOf` independently of the text/bytes choice, so embedding them as text buys nothing.

Reproduced: `contentTypeOf("/a.htm")`, `contentTypeOf("/a.cjs")`, `contentTypeOf("/a.xml")` all return `application/octet-stream`, while `/a.html` returns `text/html; charset=utf-8`.

Reached: any built frontend whose `public/` (or named `build.assets`) tree contains a `.xml` (e.g. `sitemap.xml`), `.htm` fallback or `.cjs` module. Fix: make the two lists agree — add the missing extensions to the bridge's `CONTENT_TYPES`, or drop them from `TEXT_ASSET_EXTENSIONS` and align the comment with the real invariant.

---

## 3 — `--notarize` does not "imply `--sign`"; the code refuses it outright

- `src/cli/build/stages.ts:38-42` — `stageRefusal` returns `notarize requires --sign — an ad-hoc signature cannot be submitted; add --sign with CRUST_SIGNING_IDENTITY` whenever `options.notarize && !options.sign`.
- `src/cli/build.ts:41-42` — that refusal is returned before any build step, so the invocation exits 1 having produced no artefact.
- `site/app/docs/reference/cli/page.mdx:32` — the flag table claims "`--notarize` ... implies `--sign`". The same page contradicts itself at line 43, which prints the refusal verbatim, and the introducing commit message (`d22f208`) likewise listed `crust build --notarize` as doing "sign → zip → submit → staple → validate → spctl".

The documented artefact (a notarized app from `--notarize` alone) does not exist; the real artefact is an exit-1 refusal. The code is internally consistent, so this is a claim-vs-artefact defect, not a runtime bug.

Reproduced: `stageRefusal({dir:"/p", notarize:true}, {platform:"darwin", env:{CRUST_SIGNING_IDENTITY:"Developer ID Application: X (TEAM)", CRUST_NOTARY_PROFILE:"p"}})` returns the refusal; adding `sign:true` returns `undefined`.

Reached: a user following the flag table runs `crust build --notarize` and gets a refusal naming a flag they were told is implied. Fix: correct the docs to "`--notarize` requires `--sign`", as the guide at `site/app/docs/guides/package/page.mdx:62` already does.

---

## 4 — pre-stage output describes the ad-hoc state as the final artefact under `--sign`/`--notarize`

- `src/cli/build.ts:161,162,171` — the ad-hoc sign and the `signed` flag gate on `bundlesApp(process.platform)` only.
- `src/cli/build.ts:178,180` — unconditionally prints `sign   ad-hoc (codesign --sign -)` and `gatekeeper  refused on another machine until a Developer ID signature exists`.
- `src/cli/build.ts:182-191` — `runStages` runs *after* those lines; `src/cli/sign.ts:27-37` then replaces the signature with Developer ID and prints its own verdict.

The two lines are emitted for a build whose shipped `.app` ends up Developer-ID signed and, with `--notarize`, ticket-stapled and Gatekeeper-accepted. They contradict the documented claim that "`--sign` replaces the ad-hoc signature" (`site/app/docs/reference/cli/page.mdx:19,31`). `single-app.ts:84-85` has the same ordering for a single-file build.

Reached: `crust build --sign` or `crust build --sign --notarize` on macOS. The user sees a "sign: ad-hoc" / "gatekeeper: refused" summary for an artefact that is neither. Fix: emit those two lines only when `!hasStages(options)`, or print them after the stages with the final signature state.

---

## 5 — the single-file sidecar test proves a wiring that real single-file builds cannot reach

- `src/cli/build/single-app.ts:62-65` — reads `app.config.build?.sidecars`; the comment admits "today there are no declared sidecars".
- `src/cli/build/single-app-sidecars.test.ts:24-33` — hand-builds a `SingleApp` whose config carries `build: { sidecars: ["bin/tool.sh"] }` and asserts the shipped manifest names it.
- `src/single-detect.ts:101-112` — the config a real `crust build app.tsx` produces has only `app` and `windows`; no `build` key, so `app.config.build?.sidecars` is always `undefined`.

The test's claimed artefact ("a single-file app's manifest names the declared sidecar") cannot occur on the real path, because a single file has no config in which to declare a sidecar. The wiring at `single-app.ts:65` is therefore dead for every invocation the CLI can actually make; the test passes only because it injects a shape detection never produces. This is a fixture modeling a state the system cannot produce, so it proves nothing about the shipped artefact.

Reached: any `crust build <file>`; no sidecar can be declared. Fix: either give single-file apps a real declaration path (so the test models reality) or drop the dead wiring and reframe the test as "no sidecars are named", matching the code comment.

---

## 6 — non-darwin builds validate the icon then drop it, despite the "carries the PNG" claim

- `src/cli/build.ts:150-152` — the comment says "`Resources/icon.icns` is converted through `sips` and `iconutil`, which ship only on macOS; a Linux or Windows host carries the PNG into its own artefact."
- `src/cli/build.ts:152` — the code sets `iconPath: process.platform === "darwin" ? iconPath : undefined`.
- `src/packaging/build.ts:106-108` — `assembleApp` is the only consumer of `options.app`, and `src/packaging/app.ts:97-108` is the only reader of `iconPath`; both run on darwin only.

On Linux and Windows the configured icon is read and checked at `build.ts:71-80`, then passed as `undefined`; the flat binary carries no icon at all. The "carries the PNG into its own artefact" half of the claim is false for `crust build` (icon use belongs to the separate `crust package` format path).

Reached: a cross-platform project with `app.icon` set, built on Linux or Windows. Fix: correct the comment to say the icon is ignored by `crust build` off darwin and consumed by the packaging formats instead.

---

## Worst

Finding 1. It is the only one where the build silently ships a *wrong artefact*: an app embedding stale frontend bytes from an earlier run. It contradicts an invariant written explicitly in the function's own contract, it fires on an ordinary rebuild of a documented config shape, and the existing test suite covers only the named-directory branch that enforces it — so a regression here is invisible to CI. Findings 2-4 report misleading claims or output; finding 1 changes what the recipient actually receives.
