# SKILL.md generated from the registry

The hand-written `site/public/SKILL.md` drifted the moment it was written: a blind lane given only
that file had to **guess** every plugin command, and guessed `store.get`/`store.set` when `store`
also has `save`, `keys` and `clear`. It also says "31 namespaces" when the registry has **32**.

The command surface does not need to be hand-written. It is already enumerable, with no platform and
no window:

```ts
const all = await nativePlugins(corePlugins, undefined, { app: "x" });
for (const p of all) console.log(p.name, Object.keys(p.commands));
```

Measured on this tree: 32 namespaces, every command name, e.g.
`store: get set delete keys clear save` · `window: create close focus setTitle list isOpen label
setSize getSize setPosition getPosition setAlwaysOnTop isAlwaysOnTop setFullscreen isFullscreen
minimize unminimize isMinimized maximize isMaximized setDecorations isDecorated setOpacity opacity
setCursor setCursorVisible`.

## Lane G1 — `skill-generator`

Build the generator, and a check that fails when the committed file is stale.

1. **`scripts/skill/registry.ts`** — enumerate the namespaces and commands exactly as above. Return
   `{ name, commands: string[] }[]`, sorted by name, with commands in their declared order. Handle
   the platform-dependent plugins by passing `undefined` (measured to work) and say so in a comment.
2. **`scripts/skill/render.ts`** — render the command table as markdown: one line per namespace,
   `namespace` then its commands, wrapped to a sane width. Nothing else. Keep it under 200 lines.
3. **`scripts/skill.ts`** — read the hand-written prose from `site/public/SKILL.md` and replace only
   the region between two markers, then write the file back:
   ```
   <!-- skill:commands:begin -->
   …generated…
   <!-- skill:commands:end -->
   ```
   Everything outside the markers is prose a human owns and must survive byte-for-byte. Support
   `--check`: regenerate into memory, compare with the file, exit 1 and print a diff when they
   differ.
4. **`package.json`** — `"skill": "bun run scripts/skill.ts"` and
   `"skill:check": "bun run scripts/skill.ts --check"`. Do not name either script `check` or `fmt`.
5. **A test** — `scripts/skill/render.test.ts`: the rendered table contains `store` with `save`, and
   `window` with `setCursorVisible`; the namespace count equals the registry's. Read the real
   registry, not a fixture.
6. **Put the markers into `site/public/SKILL.md`** around the existing `## Plugin namespaces (31)`
   section, replace that section's body with the generated table, and fix the heading to the real
   count. That heading is the only prose you may change; leave the rest alone.

Do not hand-edit the generated region — that is the whole point, and `skill:check` catches it.

## Prove

- `bun run scripts/skill.ts` writes the file; run it twice and show the second run is a no-op.
- `bun run scripts/skill.ts --check` exits 0; then hand-edit one command name inside the markers and
  show it exits 1 with a diff; revert.
- `bun test scripts/skill` green, `bun check`, `bun run check:lines`.
- `bun run site:build` and `bun run check:links` still pass.

## Own

`scripts/skill.ts`, `scripts/skill/**`, `package.json` (the two scripts), and
`site/public/SKILL.md` — **only** the markers and that one heading. Another lane is editing other
parts of SKILL.md right now: re-read the file immediately before writing, and if you see prose you
did not write, leave it exactly as it is.

Final message under 10 lines: the namespace count you measured, what `--check` prints when stale,
and the files touched.
