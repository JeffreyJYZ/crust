# Permission model — capabilities, deny by default

Read `../fix-wave/BRIEF.md` first. This is a feature, not a fix: it goes in as its own branch and
its own PR, and nothing here may change what an app that does not opt in sees.

## What it is

Today every page in the app can call every registered command — `shell.spawn`, `fs.writeTextFile`,
whatever `main.ts` registered. There is no way for an app to say "the settings window may read files
but the chat window may not", and no way for a page that gets script injection to be stopped from
spawning a process. Tauri calls this ACL + capabilities; Butter calls it `security.capabilities[]`.
crust has nothing.

## The shape, and why

**Deny by default, granted per window label, checked at the bridge.** The check belongs in the
invoke path, not in each plugin: a plugin that forgets cannot open a hole, and a third-party plugin
inherits the rule for free.

```ts
// src/config/types.ts
export interface CapabilityConfig {
	/** What this grant is called; a window names capabilities by these. */
	name: string;
	/** Command patterns: `dialog:*`, `fs:read*`, or the exact `shell.spawn`. */
	actions: string[];
}

export interface SecurityConfig {
	csp?: string;
	/** Capabilities. Absent or empty means every command is allowed — the behaviour today. */
	capabilities?: CapabilityConfig[];
	/** Which capabilities each window label holds. A label with no entry holds none. */
	grants?: Record<string, string[]>;
}
```

Three rules, each of which a Tauri or Butter user would expect:

1. **Absent `security.capabilities` means allow everything.** Every existing app keeps working with
   no config change. This is the one compatibility guarantee: a capability model that silently
   broke every app would be worse than none.
2. **Present and non-empty means deny by default.** A window whose label has no entry in `grants`
   holds no capabilities, so it may call nothing. That is the safe default once an app opts in.
3. **A grant is per window label**, because that is the only thing the bridge knows for sure about
   a request — the page says which window it is. Combined with the token fix, a page can no longer
   *become* another window.

**Matching.** Reuse `patternMatches` from `src/plugins/network-match.ts` if it fits; otherwise one
small matcher with `*` as the only metacharacter, the same rule the network plugin already states
("one metacharacter, so no regular expression reaches the main thread"). `shell.spawn` dotted and
`shell:spawn` colon are the same action — pick one spelling and refuse the other by name, rather
than accepting both and confusing the docs.

**The refusal.** A new `CrustError` code `forbidden`, status 403, message naming the command, the
window label, and the capability that would have allowed it — never a bare "denied", because the
person reading it is the app's own author at 2am.

## Where the check goes

`src/bridge/server/invoke.ts` `createRunner`, before the handler is called, so both the JSON and the
binary payload paths are covered by one place. `startBridge` already holds the token and the
options; it needs the compiled grants table passed in, resolved once at start rather than per call.

`app.invoke` (`src/app.ts`) is the in-process path and is **not** gated: it is the app calling
itself, not a page.

## Files you own

`src/config/types.ts`, `src/config/validate-security.ts`, `src/bridge/server/invoke.ts`,
`src/bridge/server.ts`, `src/bridge/server/types.ts`, `src/bridge/errors.ts`,
`src/runtime.ts` (pass the compiled table into `startBridge`), `src/runtime-shim.ts` if it builds the
options, plus new files for the matcher and the compiled table.

Do **not** touch `src/app-loop.ts`, `src/app.ts` or `src/bridge/window-identity.ts` — the token lane
is rewriting those right now.

Docs: `site/app/docs/guides/` gets one new page, `site/app/docs/reference/config/page.mdx` gains the
two keys, and `site/lib/nav.ts` gains the entry. Keep the page under the 200-line cap and put it
under `Guides`, beside `Files` and `Shell`, because that is where a reader looks after deciding a
plugin may touch the disk.

## Tests that must exist

- An app with no `capabilities` calls everything — the compatibility guarantee, asserted.
- An app with capabilities refuses an unlisted command with `forbidden`, naming the action.
- A window label with no grant holds nothing; a label granted `fs:*` gets `fs.readTextFile` and is
  refused `shell.spawn`.
- `dialog:*` matches `dialog.openPanel` and does not match `dialogx.openPanel`.
- An exact action matches only itself.
- A malformed capability (empty actions, a duplicate name) fails config validation by name.

## Report

`docs/agents/permissions-lane.md`, and one short section in the same voice as the rest of the docs:
what the model guarantees, what it does not (a page already holding a capability can call every
command in it; this is authorisation, not a sandbox), and that absent config means allow.
