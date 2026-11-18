# B3 docs-arm64

- Truth source: `scripts/release/targets.ts:11-18` names six targets, sixth is `bun-windows-arm64` (PE magic `4d5a`), measured on a real `bun build --compile --target=bun-windows-arm64` on 2026-11-18.
- `site/app/docs/start/install/page.mdx` already listed all six assets in its table; no page claimed five. Corrected "One file per platform" to six files (x64 and arm64 on macOS, Linux, Windows).
- Homebrew is macOS-only: formula declares `depends_on macos: :ventura` (quoted on `limits/page.mdx:9`); install page Homebrew tab now says so and points to the release binary for Linux/Windows.
- README contradicted the six-asset truth ("macOS 13+ on arm64 only ... neither are Windows or Linux"). Rewrote headline, platform support, Quickstart note and "What it will not do"; listed all six assets including `windows-arm64`.
- README is also owned by BRIEF-3 lane L3 (fix-comment-drift changes line 57). Edits here are on lines 3-9, 21-24, 85-88 — disjoint from that lane's line 57; coordinate before a second writer touches this file.
- Proof: `bun run site:build` (62 static pages), `bun run check:links` (59 routes), `bun run check:parity` (PASS, 59 rows / 32 official / 6 concepts) all green. `rg -c 'windows-arm64'` = 1 on install page and README.
- No release-asset claim remains wrong in the six pages read; limits, platforms, release and parity name no asset count, so no edit there.
