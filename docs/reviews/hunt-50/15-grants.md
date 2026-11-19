# Grants — `src/plugins/core.ts`, registry, capability resolution, grant matching

Read-only source hunt plus small `bun` probes against the real `compileCapabilities` /
`candidateActions`. No source file changed, no GUI launched, no cursor moved. `rg`/`fd` only for search.

**Count: 4 findings** (1 high, 2 medium, 1 low).

**Worst: F1 — the legacy `app:invoke` wire candidate flips a one-command-looking grant into a
blanket grant for every app command, present and future.**

---

## F1 (high, worst) — a grant that flips meaning: `app:invoke` is checked as a second candidate for every dispatched app command

- `src/bridge/server/actions.ts:10-13` — the file documents the flip itself: the wire action
  "stays a second candidate, so a capability that deliberately grants `app:invoke` still reaches
  every app command." `:20` names `app.invoke`'s dispatch field `name`, `:30-33` computes the fine
  action `app:<name>`, `:39-42` returns `[fine, wire]`.
- `src/bridge/server/invoke.ts:56-64` — the gate allows when **any** candidate matches
  (`candidateActions(...).some(...)`), so a grant for the coarse `app:invoke` authorises a fine
  `app:deleteAccount` even though the author granted only `app:invoke`.
- `src/bridge/server/app-command-grants.test.ts:84-90` asserts the flip as intended: "the legacy
  flat `app:invoke` grant still reaches every app command."
- `templates/default/crust.config.ts:8-13` (and `next:12-17`, `react:9-14`, `svelte:9-14`,
  `vue:9-14`) grant `["app:invoke"]` while the comment says "this grant names the one action the
  page actually uses." The grant's written meaning (one command) is the opposite of its compiled
  meaning (all app commands). Already noted at `docs/reviews/hunt-20/23-templates.md:10-15`; the
  mechanism lives in the grant matcher and is still live.

**Reached:** scaffold any app → keep the shipped `app:invoke` grant → add a sensitive
`app.command("deleteAccount", …)` → page calls `invoke("deleteAccount")`. The shim
(`src/runtime-shim.ts:16-19`) sends `{plugin:"app", command:"invoke", args:{name:"deleteAccount"}}`;
`effectiveAction` is `app:deleteAccount`, `candidateActions` is
`["app:deleteAccount","app:invoke"]`, and the `app:invoke` grant passes the `.some()` check.
**Measured** with `compileCapabilities({capabilities:[{name:"g",actions:["app:invoke"]}],grants:{main:["g"]}})`:
`allowed=true` for `name:"deleteAccount"`, while `covering("app:deleteAccount")` is `undefined` — the
refusal machinery cannot even name the coarse alias that authorised the call. A narrow grant
(`app:notes.save`) behaves correctly on its own; the flip is specific to a config that grants the
wire key, which all five scaffolds do.

**Smallest fix:** drop the wire candidate from `candidateActions` for `app.invoke` (grant only the
fine action), and update the five template configs to the narrow `app:greet`. Keep a documented
opt-in legacy flag for apps that still depend on the broad alias, rather than making it the silent
default.

---

## F2 (medium) — repeated capability names silently last-win, so a grant can bind to the wrong action list

- `src/bridge/server/capabilities.ts:83-86` — `byName.set(capability.name, capability.actions)`
  overwrites on duplicate names with no guard; a `grants` entry naming that capability then picks
  up whichever definition came last.
- `src/config/validate-security.ts:29-35` refuses duplicate names, but that runs only through
  `validateConfig` in `src/runtime.ts:43`. `startBridge` (`src/bridge/server.ts:35-50`) takes a raw
  `security` object (`src/bridge/server/types.ts:24-25`) with no validation — fixtures, e2e harnesses
  and embedding callers can pass duplicates.

**Reached:** `startBridge({ security: { capabilities: [
  {name:"g",actions:["app:notes.save"]}, {name:"g",actions:["app:*"]}
], grants:{main:["g"]} } })`. **Measured:** the compiled table allows `app:secret` for `main` —
the second, broad definition won. A grant the author wrote as narrow flips to broad with no error.

**Smallest fix:** make `compileCapabilities` throw on a repeated name, matching the validator, so a
programmatic caller gets the same launch failure a config author gets.

---

## F3 (medium) — a grant-bearing config with no capabilities compiles to OPEN (allow everything)

- `src/bridge/server/capabilities.ts:80-81` — `const capabilities = security?.capabilities ?? [];
  if (capabilities.length === 0) return OPEN`, ignoring `security.grants` entirely. `OPEN`
  (`:44-48`) answers `allows: () => true`.
- `src/bridge/server.ts:50` compiles the raw options; there is no "grants present but no
  capabilities" check.

**Reached:** `startBridge({ security: { grants: { main: ["g"] } } })` (or with
`capabilities: []`). **Measured:** `open=true`, `allows("main","secret:secret")===true`. A config that
clearly intends to restrict via `grants` flips to unrestricted. The config path is partly shielded
because `validateSecurity` rejects grant names that name no declared capability, so this is a
programmatic/embedding exposure; the documented compatibility rule (absent/empty capabilities =
open) makes the behaviour intentional but silent for anyone who writes `grants` first.

**Smallest fix:** if `security.grants` is non-empty while `capabilities` is empty, fail at
`compileCapabilities` instead of returning OPEN; keep OPEN only when both are absent/empty.

---

## F4 (low) — the `testing` namespace is resolved from an import-time snapshot while its adapter uses the live gate

- `src/plugins/core.ts:62` captures `corePlugins = corePluginsFor(process.env)` at import time;
  `:65-66` `coreRegistry()` registers that constant, not a fresh `corePluginsFor()`.
- `src/runtime.ts:50` uses that import-time `corePlugins` to build the registry, but
  `src/runtime-plugins.ts:138-141` gates adapter installation on a live `testingEnabled()` reading
  `process.env` at call time. The two can disagree in one process.

**Reached:** a process that has `CRUST_TEST=1` when `@/plugins/core` is first imported, then clears
it before `nativePlugins` runs, registers the `testing` namespace (grantable as `testing:*`) with no
adapter installed — every `testing.*` invoke returns an "adapter absent" refusal. The mirror
(env set only at `nativePlugins` time) installs the adapter but leaves the namespace unregistered,
so a `testing:*` grant names a capability nothing can call. `read`; no build or GUI needed.

**Smallest fix:** resolve the namespace and the adapter from one value — pass the live
`testingEnabled()` result into both registry construction and adapter installation.

---

## Checked and clean

- **Per-label authority binding** — `read`: `src/bridge/server.ts:55-56` binds the process token to
  `DEFAULT_WINDOW_LABEL`; `src/bridge/server/handler.ts:87-94,177` mints a per-document token and
  reads authority from `state.labels`, never the body's `window`; `invoke.ts:28-31,66-68` keeps
  routing and capability authority separate. The old label-spoof defect
  (`docs/reviews/next-wave/defects.md` §1) is not reachable.
- **Matcher shape** — `read` + `measured`: `src/plugins/network-match.ts:23-45` with
  `caseInsensitive:false` (as `capabilities.ts:68-70` passes) gives the single-metacharacter,
  colon-separator behaviour the tests at `capabilities-match.test.ts:14-47` assert; `app:notes.*`
  does not match `app:invoke`. No regex reaches the main thread.
- **Unknown capability / unknown command / duplicate handler** — `read`: `capabilities.ts:91`
  drops an unresolvable capability name (never widens), `registry.ts:27-32` refuses duplicate plugin
  names, `:100-107` `addHandler` refuses duplicate flat keys from record sources. The two
  registry namespace-shadowing/prototype findings in `docs/reviews/hunt-20/21-registry.md` remain
  separate scope and are not re-counted here.
- **Grant validation** — `read` + tests: `validate-security.ts:13-14,46-59` enforces the
  `plugin:command` spelling and refuses dotted actions; `:63-84` refuses grant names that name no
  declared capability; `validate-security.test.ts:65-77` confirms the narrow `app:notes.save`
  spelling is accepted.
