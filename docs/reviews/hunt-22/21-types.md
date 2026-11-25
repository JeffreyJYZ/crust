# types — read-only defect hunt

Scope: casts, `any`, non-null assertions, unsound type guards/narrowing across `src/**`. No source
files changed. Tree at review: `2174a6d` (`docs(install): re-measure the tag for 0.2.18`), clean
worktree.

## Findings

### 1. Medium — `isCrashRecord` asserts a full record after checking two fields

`src/platform/darwin/crash-record.ts:97-101`

```ts
export function isCrashRecord(value: unknown): value is CrashRecord {
	if (typeof value !== "object" || value === null) return false;
	const record = value as CrashRecord;
	return typeof record.at === "string" && typeof record.handler === "string";
}
```

`CrashRecord` (`:28-41`) also declares `signal: string | null`, `code: number | null`,
`address: string | null` and `exitCode: number | null`; none are checked. `StoredCrash`
(`src/runtime-crash-write.ts:31-35`) adds a required `type`, also unchecked. `asStored`
(`src/runtime-crash-write.ts:155-159`) casts again and returns the object as `StoredCrash`;
`readLastCrash` and `listCrashes` (`src/runtime-crash-store.ts:43-48,52-71`) hand those objects to
`crash-reporter.last/list` (`src/plugins/crash-reporter.ts:99-106`) as typed data.

A line such as `{"at":"…","handler":"…","signal":{},"code":"x"}` passes the guard and is typed as
if every field had its declared type. The type system cannot flag a consumer that treats `code` as a
number or formats `signal` as a string. This is an unsound predicate on disk input, not a hypothetical
state: `crashes.log` is parsed line by line and a torn or hand-edited line is exactly the case the
guard is there for.

### 2. Medium — `typedHost` types `ctx` as always present; `app.invoke` never passes it

`src/bridge/typed.ts:53-56,82-89`

```ts
handler: (input: M[K]["input"], ctx: PluginContext) => MaybePromise<M[K]["output"]>,
...
app.command(name, handler as unknown as CommandHandler);
```

`typedClient.invoke` (`src/bridge/typed.ts:103-105`) routes through `app.invoke`, which calls
`invokeCommand(handler, args)` (`src/app.ts:130-133`), and `invokeCommand` invokes
`handler(args)` with **one** argument (`src/plugins/define.ts:91-97`). The module comment at
`typed.ts:48-51` admits `ctx` is `undefined` on this path, but the type says `ctx: PluginContext`
(non-optional). A handler that does `ctx.emit(...)` type-checks and throws at runtime. The
`as unknown as CommandHandler` double cast is what lets the two-argument handler into
`App.command`, whose own handler type takes one argument (`src/app-types.ts:69`). The check at the
registration site is real for name/input/output; the `ctx` half of the contract is a type lie.

### 3. Medium — a non-refusal `unknown` answer is asserted to a full `PerfSampleLike`

`src/perf/overlay/overlay.ts:120-130`

```ts
.then((answer) => {
	runtimeMounted = !refusal(answer);
	sampled = runtimeMounted ? (answer as PerfSampleLike) : undefined;
})
...
.finally(() => panel.update(lines(frame), frame.p95, now()));
```

`perf.sample()` is typed `(): unknown` (`overlay.ts:21`). The only runtime check before the cast is
`refusal()` (`:56-60`), which looks for `code === "not-implemented"` or a string `requires`. Every
other value, including `null`, a string, `{ ok: false }`, or a partial sample, is asserted to
`PerfSampleLike`. `lines()` then dereferences `s.runtime.eventLoopDelayP95.toFixed(2)`,
`s.events.emitted`, `s.invoke` and `s.runtime.heapUsed` (`:98-103`) with no guard.

The throw lands in the `.finally` callback, which has no `.catch` after it, so a malformed answer
produces an unhandled rejection and the panel stops updating. The type assertion is the only thing
that convinced the compiler the nested shape exists.

### 4. Medium — wire `error.status` asserted `as number`, bypassing the guard used three lines below

`src/bridge/client/invoke.ts:119-126`

```ts
const status =
	reply && reply.ok === true ? 200 : (reply?.error?.status as number) || 500;
onAnswer(status, reply?.error?.message);
```

`reply` comes from the content-world `crustInvoke` function, so `error.status` is untrusted wire
data. Unlike `fail()` at `:88-94`, this site performs no `typeof error?.status === "number"`
check. A string status such as `"200"` is truthy, reaches `onAnswer("200")`, and
`markHandshake` (`src/bridge/client/install.ts:55-61`) compares `"200" < 400` with JS coercion and
resolves `ready` even though the invoke failed. The code already has the correct guard in `fail()`;
the assertion at `:123` skips it.

### 5. Medium — the page API is typed but built on `Record<string, any>` and assertion casts

`src/bridge/client/install.ts:21-24,121-125,136-144,182-198`

```ts
const scope = target as unknown as Record<string, any>;
if (scope.crust) return scope.crust as T.CrustApi<Schema>;
...
resolve(payload as T);
...
invoke: invoke as T.TypedInvoke<Schema> & T.LooseInvoke,
```

`scope` being `Record<string, any>` makes every read of `__CRUST__`, `crustInvoke`, `location`,
`document` etc. unchecked (`resolved.token`, `resolved.window` and `resolved.url` are all `any` at
`:38-39,108`). `listen<T>` casts a callback that receives `unknown`; `once<T>` resolves an
arbitrary event payload as `T`; `invoke` is a `(name: string, command?: unknown, args?: unknown) =>
Promise<unknown>` asserted to a schema-typed API. A page that sets `window.crust` before the bridge
installs gets its object returned as `CrustApi<Schema>` with no shape check at all.

This boundary is partly by design (there is no wire schema for events), but the result is that the
typed surface (`TypedInvoke`, `once<T>`, `CrustApi<Schema>`) gives compile-time confidence with no
runtime evidence behind it. Callers cannot tell which fields were validated.

### 6. Medium — `runStages` asserts a required env var that only a separate preflight checks

`src/cli/build/stages.ts:78-84`

```ts
const env = seams.env ?? process.env;
if (options.sign) {
	const code = await (seams.sign ?? signStage)(
		bundle,
		env.CRUST_SIGNING_IDENTITY!.trim(),
```

The `!` is justified only when `stageRefusal()` (`:35-63`) has already run; it checks
`env.CRUST_SIGNING_IDENTITY?.trim()` at `:50-51`. The CLI does call it (`src/cli/build.ts:41`), but
`runStages` is exported and also called directly by `buildSingle` (`src/cli/build/single-app.ts:91-97`)
and by tests (`src/cli/build/stages.test.ts:53,80`) with injected `seams.env`. Any caller that skips
the separate preflight gets `TypeError: Cannot read properties of undefined (reading 'trim')`
instead of the named refusal the module documents. The type says the value is a `string`; the
runtime contract says it is `string | undefined` unless another function was called first.

### 7. Low — dev handshake JSON parsed with an unchecked `as` cast

`src/vite.ts:57-70`

```ts
const parsed = JSON.parse(readFileSync(file, "utf8")) as {
	url?: string; token?: string; tokens?: Record<string, string>;
};
return { url: (parsed.url ?? "").trim(), token: (parsed.token ?? "").trim(), tokens: parsed.tokens };
```

`JSON.parse` returns `any`; the cast claims a non-null object with string fields. Valid JSON can be
`null`, an array or `{"url":7}`: `parsed.url` then throws or `.trim()` fails. The `try` at `:57`
swallows that and falls back to `env` (`:68-70`), so a malformed handshake is silently treated as an
absent one and the page gets no `window.crust` rather than a diagnostic. The cast is what hides the
missing validation from the compiler.

### 8. Low — plugin command types default to `any`, and the deep-link wrapper reintroduces it

`src/plugins/define.ts:25-30`, `src/runtime-app-deep-link.ts:13-18`

```ts
export type CommandHandler<Args = any, Result = any> = (args: Args, ctx: PluginContext) => MaybePromise<Result>;
export type CommandMap = Record<string, CommandHandler<any, any>>;
...
const commands: Record<string, (args: any, ctx: PluginContext) => any> = {};
```

`definePlugin` infers concrete command types when a plugin is declared in place, but every generic
consumer typed as `PluginDefinition`, and every value read through `CommandMap`, sees `any` for both
args and result. `createAppNamespacePlugin()` returns `PluginDefinition` (`src/runtime-app-namespace.ts:16`),
so the `invoke` handler that validates `{name, args}` at `:20-30` is already widened; the deep-link
wrapper then explicitly redeclares both parameters as `any` and passes them through. Any misspelled
argument or unchecked return in a wrapper like this compiles cleanly.

### 9. Low — non-null assertion and unvalidated canvas cast in the perf panel

`src/perf/overlay/panel.ts:80-83,107-111`

```ts
const doc: DocumentLike = options.doc ?? (globalThis as { document?: DocumentLike }).document!;
...
const canvas = doc.createElement("canvas") as ElementLike & CanvasLike;
```

`document` is declared optional in the cast but asserted non-null; with no injected `doc` in a
non-DOM context the failure is an opaque `Cannot read properties of undefined (creating 'div')`.
`DocumentLike.createElement` returns only `ElementLike` (`:23-26`), so the `CanvasLike` half
(`width`/`height`/`getContext`) is asserted without a check. A fake or minimal document that
satisfies `DocumentLike` reaches `createSparkline(canvas)` with an object that has no canvas API.

### 10. Low — `PerformanceObserver` constructor asserted after checking one unrelated property

`src/perf/overlay/sampler.ts:56-64,76-86`

```ts
const ObserverClass = (...) as ObserverCtor | undefined;
const supported =
	ObserverClass !== undefined &&
	Array.isArray((ObserverClass as unknown as { supportedEntryTypes?: unknown }).supportedEntryTypes) &&
	((ObserverClass as unknown as { supportedEntryTypes: readonly string[] }).supportedEntryTypes).includes("longtask");
```

The double casts assert a constructor with a specific callback signature and an instance with
`observe`/`disconnect`. Only `supportedEntryTypes` is inspected. The two separate casts could also
read different values from a getter with side effects. The consequences are contained by the
`try/catch` at `:77-86`, but the resulting `supported === true` can still be reported to callers
(`longTasks: number` instead of `null`) when no usable observer was constructed.

### 11. Low — generated single-file mount asserts the component as `never`

`src/single-page.ts:29-45`

```ts
"const Component = (entry as { default?: unknown }).default;",
'if (typeof Component !== "function") { … }',
"createRoot(mount).render(createElement(Component as never));",
```

The only guard is `typeof === "function"`. `as never` makes the generated TS accept any function
shape: a default export like `function Widget(props: { required: string })` or a plain function
returning a string type-checks here and fails at render time with a React prop/element error. A
cast to a minimal React component type with a runtime prop check would keep the same runtime guard
without suppressing every signature check.

## Reviewed and sound

- `src/config/schema.ts:48-84` + `src/config/validator.ts:21-27`: non-object input records an issue
  before `value as CrustConfig` is reached; no silent `null as CrustConfig`.
- `src/single-pragma.ts:86-101`: the `as SecurityConfig` cast is followed by `validateConfig`
  (`src/single-detect.ts:122-127`), so a typo still fails at build.
- `src/logging/record.ts:44-56`: `isRecord` checks every non-index-signature field of `LogRecord`.
- `src/bridge/server/page-log.ts:21-37`: `KINDS.has` runs before the `kind` cast; all other fields
  are checked with `typeof` before assignment.
- `src/bridge/server/bytes.ts:31-68`, `src/bridge/server/actions.ts:23-27`,
  `src/plugins/updater-args.ts:171-184`: object/string narrowing happens before the field cast,
  and `__proto__` is written with `defineProperty`.
- `src/cli/assets.ts:92`, `src/perf/alloc.ts:22`, `src/platform/darwin/ownership-harness.ts:109`:
  the non-null/assertion sites are guarded by a length check, documented as a single deliberate
  runtime-shape escape, or scoped to a symbol whose FFI signature is declared at the call site.

No fixes applied.
