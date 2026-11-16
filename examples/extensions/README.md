# Extensions

An extension is a plugin a project ships as its own `.ts` file. `crust dev` imports it and
`crust build` embeds it in the binary, so a built app needs no `extensions/` directory on the
recipient's disk. It is the same `definePlugin` shape — a name plus a command map — with a brand, so
a plain plugin can never be mistaken for one.

`clock` is deliberately not a hello world: it owns state between calls (a running interval, a tick
count, a start time) and it pushes events. `startTimer` emits `clock:tick` on the interval,
`stopTimer` clears it, and `now` reports the reading.

## The files that matter

- `extensions/clock.ts` — the extension. It default-exports `defineExtension({ name, commands })`;
  a file without that default export, or with a plain plugin, is one error naming the file and the
  reason. `emit` comes from the handler context, which is the only way to reach a page.
- `crust.config.ts` — `extensions: ["extensions/clock.ts"]`. A relative entry resolves against the
  project, so `clock.ts` names the same file; absent, crust discovers every `*.ts` under
  `extensions/` in filename order. An entry that climbs out of the project is refused, because a
  build cannot embed it from a fresh clone.
- `public/app.js` — the page half: `window.crust.invoke("clock", "now")` is the plugin form, and
  `window.crust.listen("clock:tick", …)` subscribes to what the extension emits.

`main.ts` is the backend half — it calls `clock.commands.now` directly and prints what came back,
which is the same module instance the page reaches over the bridge. Nothing in it registers the
extension; `crust dev` and `crust build` do that from the config.

## Commands

From the repository root:

```sh
bun run src/cli/index.ts dev --dir examples/extensions      # run it, window and page
bun src/cli/index.ts build --dir examples/extensions        # compile dist/Extensions.app
```

The build prints an `extensions 1 file embedded` line, and the generated entry in
`examples/extensions/dist/crust-entry.ts` carries both blocks:

```ts
import extension0 from "/abs/path/examples/extensions/extensions/clock.ts";
const registry = extensionRegistry();
registry.register(extension0);
```

That registry is handed to `startApp`, which registers it into the core set when it builds the
bridge, so `clock.now` from the page is served by the extension compiled into the binary.
