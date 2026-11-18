# Lane L7 — fix-release-scaffold

## What this lane owns

New files only: `templates/*/.github/workflows/release.yml`, `site/app/docs/guides/release/page.mdx`, `src/cli/release-scaffold.test.ts`. No edits to `commands.ts`, `usage.ts` or `parse.ts` — Lane L6 owns argument handling and edits those same files.

## Measured facts

- `crust` has no `release`, `update publish` or app `--target` command. `COMMANDS` (`src/cli/commands.ts:16-25`) is `init, dev, build, sign, dmg, package, notarize, doctor`. `bunx crust build --help` prints no `--target`. `--target` exists only in `scripts/build-standalone.ts`, which compiles crust itself.
- `crust build` is host-only: `iconPath: process.platform === "darwin" ? …` and `const signed = process.platform === "darwin"` (`src/cli/build.ts`). Cross-compiling an app means running the same command on a runner of the target OS.
- `crust package` names artifacts `dist/<app.name>-<app.version>.dmg` (`src/cli/package/options.ts:30-36`) and defaults to dmg.
- `crust init` copies every asset under a template, dotfiles included (`src/cli/assets.ts:41-49` uses `readdir`, not a glob). Tested: all five scaffolds receive `.github/workflows/release.yml`.
- `scripts/build-standalone.ts:107` uses `Bun.Glob("**/*")`, which skips dotfiles, so adding a `.github/` workflow does not move its pinned scaffold file counts. Whether `--asset=templates` embeds dotfiles into a compiled crust was not verified here; the standalone gate counts new-style files only.
- `check-links` ignores orphan pages — it only validates links that exist. `site/lib/nav.ts` is hand-maintained and outside this lane's files, so the new guide is reachable by URL but not yet in the sidebar.

## The publisher recipe, verified end to end

`openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64` produces the raw 32-byte key `updater.pubkey` pins (the SPKI DER form is 44 bytes and is refused). `openssl pkeyutl -sign -inkey key.pem -rawin -in <archive> | base64` produces the 64-byte signature. Checked with `verifyEd25519` from `src/plugins/updater-signature.ts`: true; decoded sizes 32 and 64. OpenSSL 4.1.0 here.

## Trap

Putting a `.test.ts` next to a template or doc page would either ship it into scaffolds or sit outside `bun run test`'s path list. The regression guard belongs in `src/cli/`, which the gate collects.

Adding any file to `templates/next/` also breaks `src/cli/assets.test.ts:9`, which pins the exact asset list; the new `.github/workflows/release.yml` sorts first (`localeCompare` puts `.` before letters). That test had to be updated in the same change — a green gate is the only proof the scaffold is safe.

Handoff: at the end of this lane, `bun run test` had 1796 pass / 3 fail and `bun run check:lines` had one 286-line file, both entirely in `src/platform/darwin/native-ownership.test.ts` (Lane F3's live file, C compile error in the shim it is editing). Not mine, not reverted. A second `bun run site:build` collided with another lane's concurrent Next build; the first build passed with `/docs/guides/release` in the route list.
