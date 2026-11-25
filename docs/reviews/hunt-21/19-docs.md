# Hunt 21 — documentation as a claim about the code

Scope read: `site/app/docs/**`, `site/public/SKILL.md`, `README.md` (top section), `docs/agents/**`, and the
source each claim names. Labels: `read` = I read the code; `measured` = I ran a read-only command
(`git ls-remote`, `git show`, a short `bun -e` that counted tokens in a file). No e2e, no GUI, no
cursor, no file edited but this one. Hunt-20's `17-docs.md` was read first; its findings are not repeated
here except where the fix created a new mismatch or the same file drifted again.

## Medium — Agent memory states three security holes as live that the code has already fixed
- where: `docs/agents/defects.md:3`, `:4`, `:5`
- mechanism: All three bullets are present-tense security claims in a file future sessions load as truth.
  (1) Line 3 says capability grants key on a request-body `window` label and are bypassable on Linux,
  Windows and Vite-dev; `src/bridge/server/handler.ts:191` (`read`) passes the token-bound label as
  `authority`, and `src/bridge/server/invoke.ts:68-70` (`read`) checks
  `capabilities.allows(authority, candidate)` — `routing` only sets `ctx.window` (`:89`).
  (2) Line 4 says `updater.check` fetches a page-supplied endpoint with no URL policy;
  `src/plugins/updater-url.ts:2-3` (`read`) declares the policy for both `download` and `check`, and
  `src/plugins/updater.ts:81-88` (`read`) calls it for `check` before fetching.
  (3) Line 5 says `shell-env` compares injection names by exact spelling so lowercase
  `node_options` bypasses; `src/plugins/shell-env.ts:24-31` (`read`) folds both sides to lowercase and
  prefix-matches `dyld_`.
- reachable by: Any later agent or human reading this memory treats the bridge as having an
  ATO-class grant bypass, an unrestrained fetch surface and an env-injection bypass. The plausible
  failure is a "fix" that removes the token-bound authority or weakens the URL/env checks, i.e. work
  that reopens the very holes the notes claim are open. Repo-local memory is authoritative for
  sessions that do not re-read source.
- smallest fix: Mark each bullet fixed with the code reference above (or delete it). Keep the *reason*
  each check exists — that is the durable lesson — but not the false present-tense verdict.

## Low — Agent memory still calls three wired surfaces "not wired" or reports fixed doc gaps as open
- where: `docs/agents/preview-darwin.md:51`, `docs/agents/changelog-truth.md:10`, `docs/agents/window-webview.md:28`
- mechanism: `preview-darwin.md:51` (`read`) says `preview.show`'s `fs.scope` containment, the
  capability, the cross-platform `not-implemented` refusal, docs and the e2e are "not wired yet";
  `src/plugins/preview.ts:95` (`read`) calls `scope().check`, `src/plugins/preview-surface.ts:90-131`
  (`read`) supplies the three named refusals, and `site/app/docs/guides/preview/page.mdx` plus
  `e2e:preview` exist. `changelog-truth.md:10` (`read`) says `reference/parity/page.mdx:69,130` still
  calls Linux keychain not-implemented and `:137` still lacks sweep cases; the live page at `:70`
  (`read`) names Linux `list` as the only refusal and `:138` says the `shortcut.*`/`autostart.*` gap is
  closed. `window-webview.md:28` (`read`) points at `src/runtime-plugins.ts:184` calling
  `network.darwinNetworkAdapter()` with no configuration; no such call remains in that file (`read`,
  `rg -n "darwinNetworkAdapter" src/runtime-plugins.ts` empty) — wiring now lives in
  `src/runtime-network.ts:22` (`read`).
- reachable by: A resumed lane or a future agent follows these notes, re-fixes the parity table or the
  network wiring, or tells the user a shipped surface is missing. All three notes are dated work
  logs whose "left for the owner" lines were never closed out.
- smallest fix: Convert each to a resolved note with the file that closed it, or drop the residue lines
  and keep only the measured fact above them.

## Low — Browser guide says capture dimensions equal the last `setBounds` size; they are page pixels
- where: `site/app/docs/guides/browser/page.mdx:30`
- mechanism: The same sentence says the PNG is "at the surface's own page pixels" and that its
  `width`/`height` "are what `setBounds` last set". `setBounds` takes window points and passes them
  through unchanged (`src/plugins/browser-args.ts:42-75`, `src/platform/darwin/browser-ports.ts:80-81`,
  both `read`); the PNG's dimensions come from `pixelsWide`/`pixelsHigh`
  (`src/platform/darwin/shim/123_snapshot.c:111-112`, `read`) with `scale = pixels / frame width`
  (`:154`, `read`) and are returned verbatim (`src/platform/darwin/shim/124_snapshot_read.c:7`, `read`).
  On a Retina display a 480×640 bound therefore reports 960×1280. `site/public/SKILL.md:358` (`read`)
  already states "page pixels" correctly.
- reachable by: An app author sizes an `<img>` or canvas from `capture.width` expecting the rectangle
  they reserved and gets double that on HiDPI; layout code that maps capture coordinates back to
  bounds divides by the wrong factor.
- smallest fix: Replace "are what `setBounds` last set" with "are the surface's page pixels — the bound
  in points times `scale`" and point at `scale` in the same answer.

## Low — Pty guide calls the 64 KiB write limit UTF-8 bytes; the code counts UTF-16 code units
- where: `site/app/docs/guides/pty/page.mdx:27`
- mechanism: The guide says `data` is "UTF-8 text up to 64 KiB, so a larger paste is the page's to
  split". `src/plugins/pty-args.ts:18` (`read`) sets `PTY_MAX_WRITE = 64 * 1024`, but `:89-93`
  (`read`) compares `data.length` — a JavaScript string's UTF-16 code-unit count — and the error text
  also calls it "bytes". A 60,000-character string of non-ASCII BMP characters passes the check yet
  encodes to ~120 KiB; `src/plugins/pty-posix.ts:43` (`read`) hands the string to `term.write` and
  `src/platform/windows/pty-conpty.ts:96-99` (`read`) converts it with `Buffer.from(data, "utf8")`.
- reachable by: A page pastes multi-byte text that the guide says is too large and is accepted, or
  trusts the documented byte cap when budgeting frames; the Windows write also exceeds the stated
  ceiling in bytes while passing the guard.
- smallest fix: Check `Buffer.byteLength(data, "utf8")` against the cap (and name it "UTF-8 bytes" in
  the refusal), or reword the guide to "64 Ki characters" and say the cap is on string length.

## Low — API index says 38 namespaces while its own list names 39
- where: `site/app/docs/reference/api/page.mdx:7-17`
- mechanism: The sentence says "The 38 built-in namespaces", but counting the backticked names on
  lines 9-17 gives 39 (`measured`: short `bun -e` token count; `i18n` included, `unknown-plugin` on line
  17 excluded). The generated registry is 34 (`measured`: `registry()` from
  `scripts/skill/registry.ts` returns 34 names), plus the five runtime/conditional ones the list also
  names — `app`, `single-instance`, `pty`, `updater`, `testing` — equals 39. The only reading that
  yields 38 silently excludes `testing`, which the same sentence says "joins" conditionally.
- reachable by: A developer uses the stated count to audit the callable surface, finds a name that is
  not accounted for, and either doubts the index or misses one of the five conditional namespaces
  when granting capabilities.
- smallest fix: Generate the count from `registry().length` plus the named conditional set, or write
  "34 always registered, plus five conditional namespaces" instead of a single total.

## Checked and clean
- Platform support tables: `site/app/docs/reference/platforms/page.mdx`, `site/app/docs/reference/parity/page.mdx` and `site/app/docs/limits/page.mdx` match the wired adapters on the three points hardest to fake — `nativePlugins` registers a non-Darwin arm with honest `not-implemented` answers (`src/runtime-plugins.ts:79-95`, `read`), `featurePlugins` attaches a real browser adapter per OS and the Windows ConPTY backend by dynamic import (`src/runtime-feature-plugins.ts:39-69`, `read`), and preview genuinely refuses on Windows/Linux for lack of a window handle / system API (`src/plugins/preview-surface.ts:90-131`, `read`). The PTY row's "works on all three" is backed by `src/platform/windows/pty-conpty.ts:31-125` (`read`), not just a stub.
- Error codes and command names: the twelve-member `CrustErrorCode` set and its statuses (`src/bridge/errors.ts:5-32`, `read`) match `site/app/docs/reference/errors/page.mdx:7-20` and `SKILL.md:419-421`; the pty codes match `src/plugins/pty-types.ts:14-19`, the browser/preview command sets match `src/plugins/browser.ts:97-177` and `src/plugins/preview.ts:88-116` (`read`). Hunt-20's shell `write`/`close` and four-omitted-namespace findings are fixed on this tree (`SKILL.md:207-243`, `api/page.mdx:9-17`, `read`).
- Security statements that are enforced: token-bound grant authority (`src/bridge/server/handler.ts:191` + `src/bridge/server/invoke.ts:68-70`, `read`), absent-but-not-foreign `Origin` handling (`src/bridge/server/cors.ts:40-50`, `read`), preview's `fs.scope` containment including the scope-store refusal (`src/plugins/preview.ts:95` + `src/plugins/fs-scope.ts:129-137`, `read`), browser's http(s)-origin gate before any native load (`src/plugins/browser.ts:107-108,129-130` + `src/config/validate-features.ts:46-66`, `read`), and the bootstrap nonce stamping (`src/bridge/server/csp.ts:67-71`, `read`). I did not re-report hunt-20's "grants follow the token" check; I verified it still holds because a stale note contradicts it.
- Newest surfaces against code: the pty 8 KiB frame (`src/plugins/pty-stream.ts:12`, `read`), 80×24 clamped to 500×200 (`src/plugins/pty-args.ts:12-16`, `read`), 64-record closed-handle cap (`src/plugins/pty.ts:39,74-79`, `read`), child-status `pty-exit` (`src/plugins/pty.ts:114-123`, `read`), browser config rejecting a path/query/fragment by index (`src/config/validate-features.ts:63-65`, `read`), and capture being macOS-only (`src/platform/windows/browser.ts:168-176`, `src/platform/linux/browser.ts:169-177`, `read`) all match their guides.
- Version pins: hunt-20's stale-pin finding is fixed — `SKILL.md:21-22,27` and `site/app/docs/start/install/page.mdx:55,94,111` pin `v0.2.11`, and `measured`: `git ls-remote --tags origin 'refs/tags/v0.2.1*'` lists both `v0.2.10` and `v0.2.11`. An earlier local `git tag -l 'v0.2.*'` ended at v0.2.10; that is a stale local clone, not a broken doc.
- `docs/agents/pty-lane.md:5-13` and `docs/agents/preview-darwin.md:9-49` are dated measurement logs; their ConPTY traps and QuickLook observations describe the shipped design and I found no present-tense claim there that current code contradicts.
