# Hunt 50 — two places that disagree about the same thing (duplicated contracts)

Read-only. `rg`/`fd` only, plus a few small `bun -e` counters over files already located. No source was
edited, no GUI app launched, no cursor moved. Scope: the whole repo, but weighted toward contracts
that are written down twice (docs, generated SKILL, e2e fixtures, nav) instead of shared through one
export. Most of `src/` was already hunted by 01–49; the disagreements below are the ones that survived
cross-checking the second side against the runtime.

**Count: 4 new findings. Worst: F1.**

---

## F1 (worst) — "which plugins are always registered" disagrees between the config doc, SKILL.md and the runtime

Three places answer the same question differently. Two of them are prose contracts a reader uses to
decide what capabilities to grant; the third is the code that actually decides.

- **Side A (claims conditional):** `site/app/docs/reference/config/page.mdx:88` — "Absent or `[]`
  registers **every** built-in plugin the runtime assembles — the core set (…) plus `window`, `store`,
  `shell`, `updater` when its section exists". Plain reading: all four of `window`, `store`, `shell`,
  `updater` are present only when their config section exists.
- **Side B (claims always):** `site/public/SKILL.md:132-134` — "All 32 plugin namespaces below are
  registered before your code runs, plus `app` and `single-instance` (34 built-ins always) and
  `updater` when the config has an `updater` section". The generated table at `SKILL.md:194` (`shell`),
  `:197` (`store`), `:201` (`window`) places all three among those 32 always-on namespaces; only
  `updater` is called out as conditional.
- **Side C (the tiebreaker — runtime):** `src/runtime-plugins.ts:59` builds `createShellPlugin(…)`
  unconditionally; `:67` builds `createStorePlugin({ root: appRoot })` unconditionally; `:170` returns
  `createWindowPlugin(windowAdapter)` unconditionally; `src/runtime.ts:78` appends `single.plugin`
  unconditionally; and only `src/runtime-plugins.ts:64` gates its plugin on config (`updater === undefined
  ? [] : …`). The doc comment at `runtime-plugins.ts:29` even states the `shell` rule outright: with no
  `shell` section the allowlist is empty and every `spawn` is refused **by name** — so the namespace is
  there, answering.

**How reached:** start any app with no `shell`, `store` or `windows`-derived `window` config sections.
Those three namespaces are still in the bridge's handler table and answer invokes (`shell` refuses each
spawn with `program-not-allowed`; `store` reads/writes `store.json`; `window` opens a window). A reader
who followed Side A would believe they are absent and would grant no `shell:*`/`store:*` capability —
yet a `security.capabilities` config that omits them genuinely locks the page out of live namespaces.
Side B and the runtime agree; Side A is the outlier. This is not fixed by the earlier docs pass:
`docs/agents/docs-fixes.md:9` still describes the set as "core 7 + `window`/`store`/`shell`/`updater`",
keeping the false conditional grouping.

**Smallest fix:** rewrite `config/page.mdx:88` to say `window`, `store` and `shell` are always
registered (deny-by-default where relevant) and only `updater` is section-gated — the shape SKILL.md
and the runtime already use.

---

## F2 (low) — the documented number of built-in namespaces is three different numbers

- `site/app/docs/reference/api/page.mdx:7`: "The **35** built-in namespaces are documented by area".
  The same page's own list at `:9-16` actually names **36** distinct namespaces (34 in `:9-14`, plus
  `updater` at `:15` and `testing` at `:16`).
- `site/public/SKILL.md:132-133`: "All **32** plugin namespaces below … plus `app` and `single-instance`
  (**34** built-ins always) and `updater` when the config has an `updater` section"; the header at
  `:165` repeats "(32)" and the generated table at `:167-205` has exactly 32 rows.

**How reached:** count from the Imports page (35, or 36 counting its own bullets) versus count from
SKILL (32 in the table, 34 always, 35 with `updater`). The two are off by one in opposite directions.
`scripts/skill.ts:64-97` only regenerates the text between `skill:commands:begin/end` markers, so the
prose counts at `SKILL.md:132` and the "35" at `api/page.mdx:7` are hand-maintained and cannot be kept
in step by the `skill:check` gate — this is exactly a duplicated contract with no sharing.

**Smallest fix:** derive the count from the same registry the table is generated from, or delete the
numerals and say "the namespaces listed below".

---

## F3 (low) — the navigation contract and the docs tree disagree about the guide set

`site/lib/nav.ts` is the single hand-written list of every docs page (comment at `:1`: "The whole
navigation … One page per entry"). It disagrees with the pages that actually exist:

- **Duplicate:** `nav.ts:40` and `nav.ts:53` both emit `{ label: "Screen", href: "/docs/guides/screen" }`
  — the Screen guide appears twice in the sidebar, while `site/app/docs/guides/screen/page.mdx` exists
  once. (`bun -e` counter over the `href:` values reports `/docs/guides/screen` as the sole duplicate.)
- **Missing:** `site/app/docs/guides/sidecar/page.mdx` exists but has no `href` in `NAV`. The sidebar
  therefore hides the sidecar guide even though `SKILL.md:196` advertises `sidecar` as a namespace and
  the guide documents `CRUST_SIDECARS_DIR`.

**How reached:** a reader following the sidebar sees Screen twice and cannot reach the Sidecar guide.
The command palette is no escape: `site/lib/search.ts:1` imports `NAV` and `:11` flattens it into
`PAGES`, so rail, sitemap and palette all read the same incomplete list. The page exists on disk and
is served by its route, but no in-app navigation reaches it. All other `NAV` hrefs resolve to a real
page.

**Smallest fix:** drop the second Screen entry and add `/docs/guides/sidecar`.

---

## F4 (low) — `RELOAD_DEBOUNCE_MS`: one contract name, two values in two debounce stages

- `src/bridge/server/events.ts:22` — `const RELOAD_DEBOUNCE_MS = 80`, used at `:74` to debounce the
  `dev:reload` signal file the bridge watches.
- `src/cli/dev/reload.ts:16` — `export const RELOAD_DEBOUNCE_MS = 120`, used at `:68` to debounce the
  `public/` watcher that publishes that signal.

`reload.ts:11-13` deliberately re-exports the *other* shared contract pieces (`DEV_RELOAD_EVENT`,
`RELOAD_ENV`, `RELOAD_FILE`) from `events.ts` — so the author knew this was a shared contract and still
gave the debounce a second value under the same name. A future reader searching for
`RELOAD_DEBOUNCE_MS` gets two answers, and a change to one does not reach the other. The two stages are
different (driver publishes, bridge consumes), so the values are not "wrong" today; the defect is the
duplicated name that invites treating them as one knob.

**Smallest fix:** rename to `PUBLISH_DEBOUNCE_MS` (CLI) and `SIGNAL_DEBOUNCE_MS` (bridge), or export one
constant from `events.ts` if the stages really must match.

---

## Cross-referenced, not counted as new

- `src/config/load.ts:7` `CONFIG_FILES = ["crust.config.ts", "crust.json"]` (and the error at `:100`,
  and `api/page.mdx:34`) versus `:82-87`, where an explicit `configPath` accepts five extensions
  (`.ts`, `.mts`, `.js`, `.mjs`, `.json`). Same "which filenames are a crust config" contract stated
  twice with different sets — already filed as hunt `44-config` #5.
- `site/app/docs/reference/api/page.mdx:88` ("shellPlugin is deliberately not exported … only
  reachable as `createShellPlugin`") versus the runtime, which builds shell itself — same family as
  F1, reported here once rather than twice.
