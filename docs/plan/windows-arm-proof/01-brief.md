# windows-arm-runtime: the proof adds a command it never grants

## Symptom

`windows-arm-runtime.yml` has failed on every tag since `v0.2.3`, five in a row. The job prints its own
PASS banner, then the built binary exits 1:

```
greet     hello crust (page call answered)
resize    failed: the page never reported a viewport      (after 30 s)
```

`v0.2.2` passed. `ce1f65b` (`fix(scaffold): grant the command you ship`) landed between the two tags.

## Cause

`templates/default/crust.config.ts` now grants one command by name:

```ts
capabilities: [{ name: "app", actions: ["app:greet"] }],
grants: { main: ["app"] },
```

The workflow's resize proof patches the scaffold with a second app command, `viewport`, and the page
calls `invoke("viewport", …)`. That action is not in the capability list, so the bridge refuses it
deny-by-default. The page's `.catch` writes `console.error("viewport report failed: …")`, which nothing
in the run surfaces, so the proof waits 30 s and reports the symptom instead of the reason.

## Fix

Two halves, both in `.github/workflows/windows-arm-runtime.yml`:

1. **Grant the command the proof adds.** Patch the scaffold's `crust.config.ts` in the same step that
   patches `main.ts` and `public/app.js`: `actions: ["app:greet", "app:viewport"]`. Keep the deny-by-
   default shape — the proof should name its own action, never widen the template.
2. **Make a refusal visible instead of silent.** Set `logging: { level: "debug", console: true }` in that
   patched config, so a refused invoke prints its `bridge.refuse` line with the reason and the run's
   stdout says `forbidden` rather than timing out. This also dogfoods the level work on Windows ARM.

Optionally shorten the wait: a refusal now appears in the output immediately, so the 30 s page timeout
stays as a backstop rather than the diagnostic.

## Finding while fixing

`bridge.refuse` is a `warn`, and the mirror routes `warn` through `console.warn`, which is the
*stderr* stream — so the workflow's stdout poll would never see it. The patched step therefore also
prints the refusal reason from the combined stdout+stderr when the resize assertion fails, instead of
relying on the settle timer's `viewport stayed …` line. Confirmed locally: `crust init` renders the
config verbatim apart from its tokens, the two anchors the patch names exist in the rendered file, and
`crust doctor --dir` reports `config [ok]` on the patched result.

## Proof

`windows-arm-runtime.yml` already has `workflow_dispatch`. Prove it on a branch, not on a tag:

```
gh workflow run windows-arm-runtime.yml --ref <branch>
gh run list --workflow=windows-arm-runtime.yml --limit 1
gh run watch <id> --exit-status
```

A pass must show `viewport  open page=…`, both resizes settling inside tolerance, and no `forbidden`
line. If the runner is unavailable, say so rather than claiming a pass.

## Constraints

- Edit only `.github/workflows/windows-arm-runtime.yml` (and the brief if you need to record a finding).
- `rg`/`fd`, never `grep`/`find`; `sd`, never `sed`; never `bun fmt` without a path list.
- The repo's 200-line cap applies to `src`, `scripts`, `examples`, `site`, `templates` — not to
  `.github/workflows`.
- Push with the `jyzbot` identity (`GH_TOKEN` is already the bot) and land through a PR only if `main`
  protection requires it; this repo lets the owner merge without review, but do not force-push.
- Report the run URL, the job table, and the two log lines that prove the fix (`viewport open`, a
  settled resize). One real pass beats a description of one.
