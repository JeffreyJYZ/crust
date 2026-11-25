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

## Approved entry

`click, type and console work in a real WKWebView — skipped: private WebKit _setWindowOcclusionDetectionEnabled: is unavailable on this macOS, so the occluded page draws no frames and no evaluate can be trusted` is allowlisted. The live test drives a window parked off every display; without this private selector WebKit suspends the page's rendering and its evaluate callback never answers. `src/plugins/testing-live.test.ts` probes the selector at definition time and skips with that exact name only when it is absent; where it exists the test still asserts the call returns 1. An occluded page cannot be tested meaningfully, so a skip is honest; a green test that never ran is not.
