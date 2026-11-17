# Butter's remaining surface, checked one plugin at a time

Read `../fix-wave/BRIEF.md`. Butter source: `~/dev/resources/butter-src` (read-only, never build).

`butter-src/src/plugins/index.ts` exports exactly 25 plugins. This wave resolves the last ones that
are neither built nor already covered under another name.

## Already covered, under another name — no lane

| butter            | crust                                     |
| ----------------- | ----------------------------------------- |
| `autolaunch`      | `autostart`                                |
| `autoupdater`     | `updater`                                  |
| `crashreporter`   | `crash-reporter`                           |
| `globalshortcuts` | `shortcuts`                                |
| `findinpage`      | `findinpage`                               |
| `singleinstance`  | `single-instance`                          |
| `notifications`   | `notification`                             |
| `securestorage`   | Lane K (keychain) — running                |
| `database`        | Lane J — running                           |

## Lane L — `tray` menu rows owned by the page

Butter's `tray` builds its menu from the config and lets the page replace rows at runtime. crust's
tray has `create/items/setTitle/show/hide/destroy` — check whether `items` can be replaced after
creation, and if not add `setItems` so a menu can change without destroying the item (destroying and
recreating a tray makes the icon flicker and loses the click handler).

Files: `src/plugins/tray.ts`, `src/platform/darwin/status-bar-item.ts` if it needs a rebuild path,
tests. Prove: rows replaced in place, the click handler still fires afterwards, and a title is read
back from AppKit after the swap.

## Lane M — `dock` badge from a file

Butter's `dock` accepts an image path for the badge; crust's takes text through `setBadge`.
Verify what ours does with a path, and if it cannot, either add it or make the parity row say the
limitation. A dock badge that silently ignores its argument is the defect this lane exists to catch.

Files: `src/plugins/dock.ts`, darwin shim if an image is needed, tests.

## Lane N — the `i18n` catalogue from disk

Butter's `i18n` loads `locales/*.json` from the project. crust's takes a catalogue object from
`main.ts`. Check whether an app can load a JSON file into it without hand-writing the import, and if
not, add `load(directory)`.

Files: `src/plugins/i18n*.ts`, tests, one docs line.

## Lane O — verify the busiest plugin shape by shape

Not a feature: a read-only audit that walks Butter's 25 plugin folders and reports, per folder, which
crust plugin answers it and with which commands. Anything with no counterpart is a finding.
The output is a table in `docs/agents/butter-coverage.md` — that table is the evidence the objective
asked for, so a missing capability cannot hide behind a claim again.

Read-only. No source edits.
