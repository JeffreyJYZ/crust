# windows-arm-runtime (brief 9, lane C1)

## What the release proves today

`.github/workflows/release.yml` builds `bun-windows-arm64` on `windows-11-arm` and
`build-standalone.ts` proves `--version`, the scaffolds and `doctor/templates` on that host.
`doctor`'s `shim`/`window`/`platform` lines are macOS-only and are skipped on Windows
(`scripts/release/standalone-prove.ts:22-24`). No window opens, no COM method is called,
and no page invokes anything. So arm64 ships with the shim itself unproven.

## What I added

`.github/workflows/windows-arm-runtime.yml` — a job on `windows-11-arm` that:

1. asserts `PROCESSOR_ARCHITECTURE -eq 'ARM64'` (so a relabelled x64 runner fails loudly),
2. `crust init` a fresh project (templates/default, no flags), `bun install`,
   `crust build` through the source CLI,
3. finds the one `dist/**/crust-app*.exe`, runs it directly with stdout/stderr redirected,
   and polls for two lines before `taskkill /T`:
   - `window\s+open` — `app.on("ready")` fires after `openWindows` (`src/app.ts:156-157`);
   - `greet\s+hello crust \(page call answered\)` — the scaffold's `public/app.js`
     calls `invoke("greet", {name:"crust"})`, so this line proves WebView2 navigated,
     the page ran, the bridge crossed and the backend handler answered.

Gating: `workflow_dispatch` plus `push.tags: ["v*"]`, in a separate workflow file so a
manual run does not drag `release.yml`'s tag-only jobs into a red dispatch. Reason for no
PR trigger is in the file header: the arm runner is not available on every plan/PR and a
windowed proof costs a full install plus a 90 MB compile on arm silicon.

## aarch64 assumptions checked (no src/ change)

No concrete arm64 defect found; the guard is source inspection plus the pinned TCC
(`oven-sh/tinycc@05f0faf`), not a run on arm hardware:

- `34_slots.c:30-34` — `#if defined(__aarch64__)` is real: `arm64-gen.c:56` predefines
  `__aarch64__`. The by-value `shim_rect` branch is therefore taken on arm64, matching
  TCC's C.10 at `arm64-gen.c:976` (16-byte struct in consecutive GPRs) and the MS ARM64
  ABI for a 16-byte `RECT`. x64 keeps the pointer form.
- `36_probe.c:129-157` — the 4096-byte `__chkstk` rule is arm64 too: `arm64-gen.c:1057-1067`
  emits `bl __chkstk` at `diff >= 4096`, and the unit links no libtcc1. Only a 2048-byte
  volatile local is kept.
- `42_webview.c:103-104` — `g_url[2048]`/`g_html[512]` are static, not stack, so the
  wide buffers do not reach that threshold.
- `48_keychain.c:41-56` — hand-laid `CREDENTIALW` uses 8-byte pointers and 4-byte
  DWORD/WCHAR-sized fields; Windows is LLP64 on both x64 and arm64, so the layout is
  identical. `shim_i64` widenings in `36_probe.c` are value-preserving on both.

## Unproven

- The workflow YAML parses: `ruby -ryaml -e 'YAML.load_file(...)'` (keys, one job, 8 steps).
- I did **not** dispatch the job: this agent runs on macOS with no access to the repo's
  Actions API or a `windows-11-arm` runner. An unrun job is unproven — the file makes the
  proof possible; it does not claim the arm shim works.
- Two things the dispatched run will settle: whether the compiled Windows binary's
  `console.log` reaches the redirected file (no Windows e2e here captures a compiled
  binary's stdout), and whether the `windows-11-arm` image ships the WebView2 Runtime.
  A failure in either is a finding, not a shim verdict.
