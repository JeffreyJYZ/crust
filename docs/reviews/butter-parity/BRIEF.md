# Parity with Butter — close every gap

Butter's README claims a feature table. This wave makes each of its capabilities exist in crust, or
records in `site/app/docs/reference/parity/page.mdx` why it cannot. The objective is "Butter has
nothing we don't", so every row is either built or answered.

Read `../fix-wave/BRIEF.md` for house rules. These are features on a branch, one PR.

## The gaps, and their order

| gap                    | what it is                                                                  | lane |
| ---------------------- | --------------------------------------------------------------------------- | ---- |
| Typed IPC              | a shared `InvokeMap` both sides import, so host and webview agree at compile time | A |
| Sidecar binaries       | ship a binary in the bundle and spawn it, with stdout/exit events             | B |
| Window material        | `vibrancy` on macOS, `mica`/`acrylic` on Windows                              | C |
| Svelte and Vue templates | two more `crust init` scaffolds                                            | D |
| Plain-HTML hot reload  | a page edit reloads the window when no bundler is present                     | E |

## Lane A — typed IPC

Host and page agree on a map today only by convention. Add:

```ts
// src/bridge/typed.ts
export interface InvokeMap { [command: string]: { input: unknown; output: unknown } }
export function typedHost<M extends InvokeMap>(): {
  command<K extends keyof M & string>(name: K, handler: (input: M[K]["input"], ctx: PluginContext) => M[K]["output"] | Promise<M[K]["output"]>): void;
};
export function typedClient<M extends InvokeMap>(bridge: { invoke: ... }): {
  invoke<K extends keyof M & string>(name: K, input: M[K]["input"]): Promise<M[K]["output"]>;
};
```

Rules that make it real rather than decorative:

- A typo in a command name is a **type error**, not a runtime `unknown-command`.
- The wrong input shape is a **type error**.
- The **output type flows back** to the caller.
- It must work through both entry points: `app.command` (the host side) and `window.crust.invoke`
  (the page side) — a wrapper over each, no protocol change, no new wire format.
- One test file proves a wrong name and a wrong input each fail `bun check`; since a test cannot
  assert a type error, put the failing cases in a `.ts` file under `docs/agents/` with a comment
  saying they are expected to be type errors, and assert the *good* path at runtime.

Files: `src/bridge/typed.ts` + its test, exports from `src/bridge/client/types.ts` and
`src/index.ts`, one guide page.

## Lane B — sidecar binaries

```ts
// crust.config.ts
build: { sidecars: ["bin/ffmpeg"] }
```

- `crust build` copies each into the bundle beside the binary (macOS `Contents/MacOS/`, Linux and
  Windows next to the exe) and the copy is `0755`.
- A `sidecar` plugin: `spawn(name, { args })` → `{ pid }`, plus `sidecar-stdout` / `sidecar-exit`
  events, refusing a name not in the config.
- A path that escapes the bundle, or a sidecar not declared, is a typed failure naming it.
- Validation: a `sidecars` entry must be a relative path inside the project; an absolute one is a
  config error, because it would ship whatever is on the build machine.

Files: `src/config/types.ts`, `src/config/validate-build.ts`, `src/packaging/build.ts`,
`src/plugins/sidecar.ts` + fake + test, `src/runtime-plugins.ts`, one guide page.

## Lane C — window material

`windows: [{ …, material: "vibrancy" | "mica" | "acrylic" | "none" }]`

- **darwin**: `NSVisualEffectView` behind the webview, `NSVisualEffectMaterialUnderWindowBackground`,
  `blendingMode: behindWindow`, plus `titlebarAppearsTransparent` and a full-size content view so the
  material shows through. `opacity` and `material` together must be coherent — state which wins.
- **windows**: `DwmSetWindowAttribute` with `DWMWA_SYSTEMBACKDROP_TYPE` (`mica` = 2, `acrylic` = 3)
  and the dark-mode attribute left alone. A Windows build older than 22621 refuses the call and
  answers a typed failure rather than a silent grey window.
- **linux**: `none` only; a config naming a material on Linux fails validation by name on that
  platform rather than silently doing nothing.

Files: `src/config/types.ts`, `src/config/validate-windows.ts`, `src/platform/darwin/shim/*.c` +
`window-create.ts`, `src/platform/windows/shim/*.c` + `window-open.ts`, tests.

## Lane D — Svelte and Vue templates

`crust init --svelte`, `crust init --vue`, mirroring `--react` exactly: the same `crust.config.ts`
shape, `dev.url` pinned, `build.assets: "dist/web"`, `vite.config.ts` with the plugin. The
`scripts/build-standalone.ts` file-count expectations change for each, in the same commit as the
template — a count that drifts reddens the macOS job.

Files: `templates/svelte/**`, `templates/vue/**`, `src/cli/init.ts`, `src/cli/parse.ts`,
`src/cli/usage.ts`, `scripts/build-standalone.ts`, tests.

## Lane E — plain-HTML hot reload

With no `dev.url` there is no bundler and nothing reloads. `crust dev` watches `public/` and, on a
change, tells the open window to reload — over the bridge, not by restarting the process.

- One event, one listener in the bridge client, opt-in through the same client the page already has.
- A rebuild of `public/` that fails must not reload the window.
- Under `dev.url`, this must do nothing: Vite already owns it, and two reloaders fight.

Files: `src/cli/dev.ts`, `src/bridge/client/install.ts`, `src/bridge/server/events.ts` if a new
prelude event is needed, tests.

## Proof

Each lane: its own tests, then `bun check`, `bun run test`, `bun fmt <files>`, `bun run check:lines`,
and the parity page gains a row with the honest status. Lane C cannot run on a Mac for the Windows
half — prove the C with the assembled-`shimSource` compile and a source assertion, the way
`shim-resources.test.ts` does, and say so in the row.
