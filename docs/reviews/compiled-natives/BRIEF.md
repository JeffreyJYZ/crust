# Compiled bundle: native adapters never load

Reported by the owner against a `crust build` bundle of their app (`worktree`), and it explains a
cluster of silent failures rather than one picker.

## What was observed

```
compiled bundle   import.meta.resolve("crust") → Cannot find package 'crust' imported from /$bunfs/…
                  so the native loader returned nothing
dialog            the adapter never loaded → worktree.pick returned null in 0 ms, panel never shown
also affected     menu install and notification setup were silent in the built app
keychain          only worked because it fell back to the 0600 file
```

## What that means

Four symptoms, one class: a built app's native half is absent and every consumer degrades instead of
refusing. A `pick` that answers `null` in 0 ms is indistinguishable from "the user cancelled", a menu
that installs nothing looks like an empty menu, and a keychain that silently writes a file answers
`ok` for a secret that is no longer protected. Any of those is worse than a startup failure.

## Ground truth to establish before fixing

- Where the compiled app's native modules are looked up, and why the lookup fails under `/$bunfs`.
  `src/cli/util.ts` and `src/cli/framework.ts` already special-case `import.meta.dir.includes("/$bunfs")`,
  so the codebase knows about the embedded tree — the platform load path apparently does not.
- Whether the failure is a swallowed `catch`, a dynamic `import("@/…")` whose alias no longer resolves
  in the app's bundle, or a genuine missing file in the artefact.
- Whether `bun build --compile` embeds the platform TypeScript at all, or whether a built app is
  expected to reach a sidecar shim on disk.

## Rules for this wave

- Fix the class: a compiled bundle must load the same native adapters a dev run does, OR refuse at
  startup naming the adapter and the reason. Never `null`, never a no-op, never a file fallback that
  claims success for a security feature.
- Prove it on the real artefact: `crust build`, then run the binary, not a dev run.
- A GUI probe must not steal focus: the building lane may use the existing CI runners for the dialog
  half and must not move the cursor or launch a window locally beyond 15 s under `probe-run`.
- `rg`, never `grep`; `fd`, never `find`; never scan from `/` or `~`. Every file stays at or under 200
  lines. Gate: `bun check`, `bun run test`, `bun run test:no-skips`, `bun run check:lines`, plus the e2e
  that owns the path.
