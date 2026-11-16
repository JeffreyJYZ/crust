# Native

Two extensions, one written in Zig and one in Rust, compiled to dylibs and called through `bun:ffi`.
The sibling `examples/extensions` shows the extension seam itself with a TypeScript file; this one
shows the same seam with the work done in native code, so it earns its own example rather than
muddying that one — a native extension needs a compile step and a dylib on disk beside it, and a
standalone build cannot carry either.

## The contract, as the code defines it

- `native/clock.zig` and `native/clock.rs` export the same three C symbols with the same signatures:
  `now_ms() -> f64`, `ran_for_ms(started_ms, at_ms) -> f64`, `ticks_between(started_ms, every_ms, at_ms) -> u32`.
  Only `f64` and `u32` cross the boundary — no struct, no string — which is the same rule the
  platform shims follow.
- `src/packaging/extension-compile.ts` owns the command line: `zig build-lib … -dynamic
-femit-bin=<out> -O ReleaseSafe` emits `<stem>.dylib`, `rustc --crate-type cdylib -O -o <out>`
  emits `lib<stem>.dylib`. That `lib` prefix is why the Rust bindings name `libclock.dylib`.
- `src/packaging/extension-bindings.ts` generates the module: `dlopen(join(import.meta.dir,
"<dylib>"))` plus one typed export per symbol. `extensions/generated/` holds it.
- `extensions/clock-shared.ts` is the TypeScript half — the commands, the interval, the events.
  `zigclock.ts` and `rustclock.ts` differ only in which generated module they bind, so the language
  under the dylib is invisible above `bun:ffi`.

## Running it

```sh
bun run build:native                                  # compiles both, writes extensions/generated/
bun run src/cli/index.ts dev --dir examples/native    # window, page, two dylibs
```

The page calls `zigclock.now` then `rustclock.now` over the bridge; `main.ts` calls the generated
modules directly before the window opens, so both a direct dlopen and a bridged call are exercised.

`bun run e2e:native` does the whole thing headlessly from a script: compile, dev, both answers, exit.

## What does not work yet

`crust build` embeds the extension's TypeScript but has no native step, and a standalone binary runs
with `import.meta.dir` at `/$bunfs/root`, so the built app dies at
`dlopen("/$bunfs/root/clock.dylib")`. Native extensions are a `crust dev` (and plain `bun`) feature
until the build learns to compile the sources and place the dylibs in the bundle.
