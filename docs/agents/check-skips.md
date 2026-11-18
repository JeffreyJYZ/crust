# Skip checker

`bun test` prints `1 pass, 1 skip, 0 fail` and exits 0. Exit code alone cannot
tell CI that a test was skipped. `scripts/check-skips.ts` restores that signal.

## What it does

`bun run test:no-skips` (in `package.json`) does two things:

1. Runs the same suite as `test`, with `--reporter=junit` writing XML to
   `.junit-skips.xml` (a throwaway, gitignored, and deleted after the check).
2. Runs `bun scripts/check-skips.ts .junit-skips.xml`.

The checker reads the report, finds every `<testcase>` containing a `<skipped/>`
child, and prints its `name`. Any printed name means exit 1. With no offenders
it prints `check-skips: no unapproved skips` and exits 0.

The reporter was verified on Bun 1.4.4: `--reporter=junit` exists and requires
`--reporter-outfile`. A skipped test appears as:

```xml
<testcase name="this one is intentionally skipped" ...>
  <skipped />
</testcase>
```

## Allowlist rule

`ALLOWLIST` in `scripts/check-skips.ts` is the only set of approved skip names.
It starts empty, so every skip fails until someone adds its exact `<testcase
name="…">` string. Add a name only when the skip has a real justification, such
as a platform-only test that cannot run on this host; record the reason in the
same commit. Vague or "temporary" skips do not qualify. One entry per name, no
wildcards or prefixes — an exact match keeps the rule auditable.

`test:no-skips` is a separate script: the existing `test` script is unchanged.
Wiring this into CI is a separate decision and has not been done.
