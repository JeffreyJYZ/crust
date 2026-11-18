# Capability gaps — day two

Scope: capabilities crust has **no answer for at all**. A partial row belongs to the parity page, not here. Read against the tree at `git rev-parse --short HEAD` on 2026-11-18. Every crust claim below names the command or file that produced it.

Order is the order a person meets them: publish an update, build on CI, automate the release, test the app, debug a shipped crash, sign on Windows.

## 1. No publisher for the updater (highest)

**Try:** add auto-update to a released app.

**Today:** `updater.check` reads a JSON manifest at an https endpoint, but nothing in crust writes that manifest, signs the artifact, or hosts it. `rg -n '"(test|publish|release|version|update|icon|ci)"' src/cli/commands.ts src/cli/usage.ts` returns nothing; `COMMANDS` (`src/cli/commands.ts:16-25`) is `init, dev, build, sign, dmg, package, notarize, doctor`. The only Ed25519 key generation in the repo is `src/plugins/updater-fake.ts:115`, a test fixture. `crust package` names artifacts after `app.name`/`app.version` (`src/cli/package/options.ts:30-66`) and has no update output. Zip extraction is already solved (`src/plugins/updater-artifact.ts:36`), so that is not the gap.

**Smallest honest answer:** one `crust update publish`: take the built archive, version and notes, generate a keypair once, write `{version,url,notes,sha256,pubkey,signature}`, print the upload list. Reuse `parseManifest`, `isSha256Hex`, `compareVersions` (`src/plugins/updater-args.ts`) and `verifyEd25519` — no new crypto. Document that the endpoint is immutable-hosted and that `install` accepts only a receipt from this run (`src/plugins/updater.ts:98-110`), so the app must reach the publisher's exact bytes.

**Butter/Tauri:** Tauri yes — `tauri signer generate`/`sign` and bundler signing through `TAURI_SIGNING_PRIVATE_KEY` (v2.tauri.app/reference/cli, /reference/environment-variables). Butter no publisher — its `autoupdater` folder is `check/download/install/restart` only (`docs/agents/butter-coverage.md`).

**Cost:** small, one CLI module plus one guide page, because the consumer is finished. Without it the updater is a client for a server nobody has.

## 2. App builds cannot cross-compile

**Try:** build the macOS app in Linux CI.

**Today:** `crust build` is host-only — `iconPath: process.platform === "darwin" ? …` (`src/cli/build.ts:135`) and `const signed = process.platform === "darwin"` (`src/cli/build.ts:143`). `rg -n -- '--target' src/cli/build.ts src/packaging/build.ts` is empty. `--target` exists only for the crust CLI's own standalone build (`scripts/build-standalone.ts:58,164`), which compiles crust, not the user's app. Icon conversion also needs macOS `sips`/`iconutil` (`src/packaging/icon.ts:2`).

**Smallest honest answer:** add `--target <os>-<arch>` that passes Bun's compile target through (`scripts/build-standalone.ts` proves the shape), and refuse icon conversion off macOS with a named `requires` line rather than emitting an icon-less bundle. Keep dmg and notarize on a mac host.

**Butter/Tauri:** Tauri yes — `tauri build --target <triple>` (v2.tauri.app cross-compilation docs). Butter not measured — the local Butter audit covers plugin folders, not a CLI.

**Cost:** medium. Target plumbing is small; the honest story needs CI docs and a mac-only signing step.

## 3. No CI or release scaffold for apps

**Try:** set up a release pipeline after `crust init`.

**Today:** `crust init` copies only the five templates (`src/cli/init.ts:7-14`); `fd -H . templates examples | rg '\.github|workflow|\.ya?ml$'` is empty. No `crust release`, `publish`, `version` or test command (`src/cli/commands.ts:16-25`). The repo's own `scripts/release.ts` bumps, tags and opens a tap PR **for crust itself** and hardcodes `JeffreyJYZ/homebrew-tap` — it is not reusable by an app.

**Smallest honest answer:** a `.github/workflows/release.yml` in each template that runs build, package and update-publish with secrets, plus a `crust release` that bumps `app.version` and calls those commands. Copy the workflow like the other templates (`src/cli/init.ts:62-63`) rather than generating it from strings.

**Butter/Tauri:** Tauri yes — create-tauri-app's CI uses `tauri-apps/tauri-action@v1` (v2.tauri.app/distribute/pipelines/github). Butter not measured.

**Cost:** small-medium. One workflow per template plus one command; package, sign and publish already exist.

## 4. No way to test a built app

**Try:** assert in CI that a real window opens and an invoke round-trips.

**Today:** no test command. The repo's e2e lives in `scripts/e2e-*.ts` with its own harness (`scripts/harness/*`) and drives this checkout; none of it ships to an app — `package.json` `"files"` lists `src`, `templates`, `docs`, not `scripts`. `rg -n '"(test|e2e)"' src/cli/commands.ts src/cli/usage.ts` is empty.

**Smallest honest answer:** either a headless driver that launches the built binary with a test token, waits for the bridge and asserts over the same invoke surface, or a guide that wires a platform WebDriver and says crust provides no driver. The first is a project; the second is a page.

**Butter/Tauri:** Tauri yes — WebDriver with `tauri-driver` (v2.tauri.app/develop/tests/webdriver). Butter not measured.

**Cost:** guide small; real driver large, three platform engines with no shared automation seam today.

## 5. Shipped crashes cannot be uploaded or symbolicated

**Try:** find out why a user's app quit.

**Today:** the guard records signal, `si_code`, address and handler name; `site/app/docs/guides/crash-reports/page.mdx:100` states no backtrace and no symbolication. `configure` takes no `url` by decision (guide:67): Butter's plugin POSTs every crash, crust leaves that choice to the app. Records exist locally (`crash-reporter.last/list`) but there is no opt-in upload and no symbol-map step.

**Smallest honest answer:** `crash-reporter.configure({ endpoint })` as explicit opt-in that sends local records, plus docs for dSYM capture. State plainly that crust does not symbolicate and cannot without a debugger.

**Butter/Tauri:** Butter yes for upload (guide:67). Tauri has crash/Sentry plugins, not verified in this pass.

**Cost:** upload small; symbolication a separate, large project.

## 6. Windows artefacts unsigned; no App Store path

**Try:** ship the NSIS installer, or an App Store build.

**Today:** `crust sign` is codesign-only — `signApp({ mode: "developer-id" })` from `CRUST_SIGNING_IDENTITY` (`src/cli/sign.ts:26-53`). `rg -n -i 'signtool|authenticode|provisioning|app store' src/cli src/packaging src/config` is empty. “NSIS writes no icon here, so the installer carries the stock one” (`site/app/docs/guides/package-formats/page.mdx:78`). `src/packaging/entitlements.ts` holds only the two hardened-runtime JIT keys; no sandbox or provisioning config.

**Smallest honest answer:** add a `signtool`/`osslsigncode` seam to `crust sign` for the `.exe` and a package icon. For the App Store, document the refusal — sandbox, provisioning and an Apple Distribution certificate are a distribution decision, not a missing line of code.

**Butter/Tauri:** Tauri yes on both — Windows code signing (`v2.tauri.app/distribute/sign/windows`) and App Store submission (`v2.tauri.app/distribute`). Butter not measured.

**Cost:** Windows signing medium; App Store large, so recommend a documented refusal unless requested.

## Not in this lane

Isolation (`site/app/docs/reference/parity/page.mdx:87`) and the two `partial` rows are parity territory. So are all 26 plugin folders in `docs/agents/butter-coverage.md`. This lane lists only absent surfaces.
