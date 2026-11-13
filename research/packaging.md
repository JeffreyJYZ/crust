# crust — packaging probe

Measured on this machine, Bun `1.4.4+38afee6c8`, macOS 27 (Golden Gate), arm64.
Every number below names the command that produced it. Where a claim in
`DESIGN.md` did not reproduce, it is called out in [Corrections](#corrections).

Probe tree: `research/packaging/`. No `open` was used for any launch test except
one quarantined-app check noted in [Gatekeeper](#6-gatekeeper), because
LaunchServices raises a modal dialog per ad-hoc bundle and the user sees every one.

---

## 1. Binary size

| What | Bytes | Size | Command |
| --- | --- | --- | --- |
| `hello.ts`, `--compile --trim` | 89,159,906 | 85.03 MiB | `bun build --compile --trim ./hello.ts --outfile hello-trim` |
| `hello.ts`, `--compile` (no trim) | 89,159,906 | 85.03 MiB | `bun build --compile ./hello.ts --outfile hello-notrim` |
| `serve.ts` (`Bun.serve`, stays alive), `--trim` | 89,159,906 | 85.03 MiB | `bun build --compile --trim ./serve.ts --outfile serve-trim` |
| 3,000-function entry, `--trim` | 89,325,026 | 85.19 MiB | `bun build --compile --trim ./big-entry.ts --outfile big-trim` |
| 3,000-function entry, no trim | 89,325,026 | 85.19 MiB | `bun build --compile ./big-entry.ts --outfile big-notrim` |
| Assembled `.app`, allocated on disk | 86,580 KiB | 84.55 MiB | `/usr/bin/du -sk "Crust Probe.app"` |

Size check with `stat -f %z` and cross-checked with `shasum -a 256`.
Sizes are identical across runs to the byte; the hashes differ, so the builds
are not cached copies of one another.

**`--trim` changes nothing here.** `hello-trim` and `hello-notrim` are the same
89,159,906 bytes, and so are the two 3,000-function builds. The flag is not
listed by `bun build --help` at all:

```
bun build --help | rg -c "trim|aot"   # → no matches, exit 1
```

Unknown flags are accepted silently — `bun build --compile --definitely-not-a-real-flag`
builds without an error — so a `--compile --trim` that looks successful is not
evidence the flag did anything.

Adding 3,000 functions to the entry grew the binary by 165,120 bytes (161 KiB).
The file is the Bun runtime plus a rounding error; the entry's own code is not
what sets the floor.

The `.app` is the binary plus 2,789 bytes of metadata: `Info.plist` 581 B,
`PkgInfo` 8 B, `_CodeSignature/CodeResources` 2,200 B.

## 2. Cold start

Two methods, because they measure different things. Both are real timings, not
estimates.

**Method A — `hyperfine`, whole process wall clock:**

```
hyperfine --warmup 3 --runs 10 "./hello-trim" --export-json cold-hello.json
```

| Metric | `hello-trim` |
| --- | --- |
| median | **5.76 ms** |
| worst | **9.02 ms** |
| best | 4.59 ms |
| mean | 5.83 ms |
| peak RSS | 8.47 MiB |

**Method B — spawn call to first stdout newline, 10 runs** (`probe/time3.ts`,
`PROBE_BIN=<binary> bun run probe/time3.ts`), which is closer to what a crust app
actually waits for, since it stops at the first line the app prints:

| Binary | median | worst | all 10 (ms) |
| --- | --- | --- | --- |
| `hello-trim` | **3.97 ms** | **23.64 ms** | 3.65, 3.76, 3.80, 3.83, 3.91, 4.02, 4.25, 4.53, 4.77, 23.64 |
| `serve-trim` (`Bun.serve` up) | **4.37 ms** | **6.82 ms** | 4.11, 4.24, 4.26, 4.32, 4.36, 4.38, 4.46, 4.54, 4.62, 6.82 |

Method B's clock starts when `Bun.spawn` returns, which is after fork/exec but
before the image is fully mapped, so it **understates** the true
kernel-to-first-byte gap. Method A wraps the whole process and is the honest
figure for "how long until it exits"; treat 5.76 ms as the number and the 23.64 ms
outlier as scheduler noise on a loaded machine, not a property of the binary.

Starting a real `Bun.serve` costs about 0.4 ms over printing a line — HTTP
serving is not the cold-start problem. Whatever `WKWebView` costs is entirely
additional and is not measured here; `DESIGN.md` predicts it dominates, and this
probe cannot confirm or deny that.

Both are far inside `DESIGN.md`'s sub-300 ms bar.

## 3. The `.app` that launched

```
Crust Probe.app/
  Contents/
    Info.plist                     581 bytes
    PkgInfo                          8 bytes
    MacOS/crust-probe       88,642,144 bytes
    _CodeSignature/CodeResources  2,200 bytes
```

`Info.plist` exactly as it launched (`plutil -lint` → `OK`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>dev.crust.probe</string>
	<key>CFBundleExecutable</key>
	<string>crust-probe</string>
	<key>CFBundleName</key>
	<string>Crust Probe</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
</dict>
</plist>
```

`Contents/PkgInfo` is the 8 bytes `APPL????`.

Note the binary inside the bundle is 88,642,144 bytes while the same compile
step produced 89,159,906: the ad-hoc codesign pass rewrites the Mach-O to embed
the signature. Report the signed size when talking about what ships.

## 4. Signing

**Ad-hoc only:**

```
codesign --force --sign - --timestamp=none "Crust Probe.app"
```

```
Executable=.../Crust Probe.app/Contents/MacOS/crust-probe
Identifier=dev.crust.probe
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20400 size=173000 flags=0x2(adhoc)
Signature=adhoc
Info.plist entries=6
TeamIdentifier=not set
Sealed Resources version=2 rules=13 files=0
```

`codesign --verify --verbose=4`:

```
Crust Probe.app: valid on disk
Crust Probe.app: satisfies its Designated Requirement
```

**Ad-hoc + hardened runtime:**

```
codesign --force --sign - --timestamp=none --options runtime "Crust Probe.app"
```

```
CodeDirectory v=20500 size=173008 flags=0x10002(adhoc,runtime)
Runtime Version=26.5.0
Signature=adhoc
TeamIdentifier=not set
```

Verify still passes; the bundle still launches. Adding `--options runtime` changed
nothing observable except the flags word and `Runtime Version`.

The final bundle on disk carries runtime **and** the JIT entitlement
(`flags=0x10002(adhoc,runtime)`, `jit.entitlements` sealed in):

```xml
<key>com.apple.security.cs.allow-jit</key>
<true/>
```

**`spctl` — the same verdict every time, in all three signing configurations:**

```
$ spctl -a -vvv "Crust Probe.app"
Crust Probe.app: rejected
$ echo $?
3
```

`spctl -a -vvv --raw` gives the machine-readable reason:

```
assessment:authority:flags = 0
assessment:remote       = true
assessment:verdict      = false
```

`--options runtime`, the JIT entitlement, and `--timestamp=none` make no
difference to `spctl`: ad-hoc is ad-hoc. This matches `DESIGN.md` §8 — an ad-hoc
signature cannot be notarized and Gatekeeper refuses it — and is now measured
rather than asserted.

## 5. JIT under hardened runtime

`DESIGN.md` §8 says hardened runtime "blocks writable-executable memory without
`com.apple.security.cs.allow-jit`", implying the entitlement is load-bearing.
It is not load-bearing for Bun's own JavaScriptCore on this machine.

A probe that serves `new Function("a","b","return a + b")` over loopback was run
inside the bundle, launched via LaunchServices from a quarantined copy:

| Signing | `/jit` response |
| --- | --- |
| adhoc + `--options runtime` + `allow-jit` entitlement | `200 {"jit":"ok","result":5}` |
| adhoc + `--options runtime`, **no entitlement at all** | `200 {"jit":"ok","result":5}` |

Dynamic codegen worked both times. Whatever hardened runtime is blocking on
macOS 27, it is not `new Function` in Bun's main thread. Keep the entitlement —
it is free and it is what Apple documents — but do not treat its absence as a
proven failure mode, and do not claim the app is broken without it.

Untested: whether `WKWebView`'s **separate WebContent process** needs anything
different. That process has its own entitlements and is not covered by this
probe. That is the case where the entitlement story actually matters, and it is
the M0 spike's job, not this one.

## 6. Gatekeeper

A locally built bundle has **no** quarantine attribute:

```
$ xattr -l "Crust Probe.app"
com.apple.provenance:
$ xattr -p com.apple.quarantine "Crust Probe.app"
xattr: Crust Probe.app: No such xattr: com.apple.quarantine
```

`com.apple.provenance` is set by the build, not by Gatekeeper, and does not
block anything.

To simulate a recipient, quarantine was set explicitly:

```
xattr -w com.apple.quarantine "0083;00000000;Safari;" "<copy>.app"
```

Two different outcomes, and the difference is the most important finding here:

**Launched through LaunchServices (`open`), quarantined: it ran.** The app was
translocated to a read-only throwaway path and executed from there:

```
/private/var/folders/mv/…/T/AppTranslocation/4FF58B52-…/d/Quarantined Probe.app/Contents/MacOS/crust-probe
```

No dialog was captured on this run, and the `open -W` call returned 0. This was
the one permitted LaunchServices check, and it will not be repeated.

**Executed directly, quarantined: killed by the kernel.**

```
$ "/tmp/gk/Locate Probe.app/Contents/MacOS/locateprobe"
$ echo $?
137          # 128 + 9, SIGKILL, no output, no dialog
```

The same binary without the quarantine attribute exits 0 and prints normally.
So quarantine on a directly-executed Mach-O is a silent SIGKILL.

### The operational consequence

**Direct binary execution — `App.app/Contents/MacOS/<bin>` — is the only quiet
way to test a launch.** It bypasses LaunchServices entirely, raises no dialog,
and returns a clean exit code. But it is only quiet while the binary is
unquarantined, which is true of anything built locally and false of anything
downloaded.

That means any CI-style launch check must run the binary inside the bundle, never
`open`. A CI runner builds its own artifact, so it carries no quarantine and the
direct exec is both quiet and representative. `open` in CI would either hang
waiting for a human to dismiss a dialog, or silently translocate and test a
different path than the one under test.

## 7. Working directory and environment

Same compiled probe run two ways. `probe/envprobe.ts` writes a JSON report;
`probe/locate.ts` additionally probes for a `Contents/Resources/asset.txt`.

| | From a terminal | Through LaunchServices |
| --- | --- | --- |
| `process.cwd()` | the shell's cwd | **`/`** |
| `process.env.PWD` | the shell's cwd (correct) | **the shell's cwd (stale — wrong)** |
| `process.execPath` | the path you invoked | the bundle's `Contents/MacOS/<bin>` |
| `import.meta.dir` | `/$bunfs/root` | `/$bunfs/root` |
| env key count | 74 | 74 |
| env keys only in one | — | — |
| env values that differ | — | `_` only (`…/probe/envprobe` vs `/usr/bin/open`) |

So: **working directory changes, environment does not.** The full key set is
identical between the two launches and the only differing value is `_`, the
shell's last-command variable, which is meaningless to the app.

`PWD` is actively dangerous — it survives from whatever shell ran `open` and
points at a directory unrelated to the app. Never read it.

**Resource lookup.** Which candidate path actually found `Contents/Resources/asset.txt`:

| Candidate | Resolves? |
| --- | --- |
| `process.cwd()` + `/Contents/Resources/…` | no — cwd is `/` |
| dirname of `process.execPath` + `/Contents/Resources/…` | no — that is inside `Contents/MacOS/` |
| **`execPath` minus `/Contents/MacOS/<bin>` + `/Contents/Resources/…`** | **yes** |
| `dirname(execPath) + "/../Resources/…"` | yes |

So crust must derive its bundle root from `process.execPath` by stripping
`/Contents/MacOS/<executable>`, exactly as `DESIGN.md` §8 assumes. Neither cwd
nor `import.meta.dir` can be used — `import.meta.dir` is `/$bunfs/root` inside a
compiled binary, which is Bun's virtual filesystem, not the bundle.

Note that under AppTranslocation the same derivation still works, because the
translocated path preserves the `Contents/MacOS/` structure. Anything that
hardcodes an absolute install path does not.

## 8. What a stranger actually has to do

There is no Developer ID certificate on this machine, so the honest answer:

1. **Nothing works by double-clicking.** `spctl` rejects the bundle, so a
   quarantined download will not launch normally. The recipient either
   right-clicks → **Open** → **Open** in the dialog (once per app), or runs
   `xattr -dr com.apple.quarantine "/Applications/Crust App.app"` first.
2. **If they are given a raw binary instead of a `.app`, quarantine kills it
   silently with SIGKILL 137** — no dialog, no crash report, no clue. That is a
   worse experience than the app path, which at least raises a dialog.
3. **The `.app` must be the shipping unit**, exactly as `DESIGN.md` §8 says. A
   bare binary is not double-clickable and, when quarantined, dies without
   explaining itself.
4. **After the first consent, it launches normally forever** — Gatekeeper records
   the decision per bundle identity.
5. **Changing the bundle re-triggers it** — a new `CFBundleIdentifier` or a
   rebuilt binary is a new decision.
6. **This is macOS 27 behaviour.** An unsigned bundle being translocated and run
   is looser than older releases; do not assume a given macOS build will be this
   forgiving, and do not test that assumption by shipping.

## 9. Notarization

`notarytool` is present:

```
$ xcrun --find notarytool
/Applications/Xcode.app/Contents/Developer/usr/bin/notarytool
```

It is not usable for this app: notarization requires a Developer ID signature,
and an ad-hoc signature cannot be notarized. Presence recorded; nothing
attempted, per the brief.

## Corrections

Claims in `DESIGN.md` that this probe contradicts, or cannot support.

**§1 "The size truth" — the 23 MB figure is wrong by 3.7×.**
It says `bun build --compile --trim` "measured at 23 MB for a hello-world, so
that floor is real and not reducible." On Bun 1.4.4 stable the same command
produces **89,159,906 bytes (85.03 MiB)**. Every build in this probe landed at
85 MiB regardless of entry size; a hello-world and a 3,000-function entry differ
by 161 KiB. The floor is real, but it is ~85 MiB, not ~23 MB, and the "20–25 MB"
range in the same section inherits the error.

The 23 MB number is reachable — Bun's own issue tracker reports 22.9 MiB for
`--aot --trim` on a **canary** build. `--aot` is not in 1.4.4 stable's
`bun build --help`, and passing it changes nothing (still 89,159,906 bytes). So
the design's floor was probably measured on a canary with `--aot`, and on the
stable release crust would actually build with, it does not hold.

This matters beyond a doc fix: an 85 MiB app is a different product decision
from a 23 MB one, and it is the difference between "comparable to Electron" and
"clearly better". The "no bundled Chromium" claim still stands; the "small app"
framing does not.

**§8 — the JIT entitlement is not proven load-bearing.** §8 states hardened
runtime blocks writable-executable memory without `allow-jit`, and lists the
entitlement as required. Measured: `new Function` runs fine under
`--options runtime` with no entitlement whatsoever. Keep the entitlement, but the
claim as written is unverified for Bun's own runtime. The `WKWebView` WebContent
process is the case that may still need it, and that is unmeasured here.

**§11 "Cold start" method — `hyperfine "open -W -a 'Crust App.app'"` will not
work as written.** It measures LaunchServices, not the app: `open -W` returns
when the app is *handed off*, a dialog can hold it open indefinitely, and a
quarantined bundle is translocated so the run no longer reflects the path under
test. Measure the process directly instead — run
`"Crust App.app/Contents/MacOS/<bin>"` under `hyperfine`, which is what the
numbers in [§2](#2-cold-start) above do. `open` is for the human acceptance
check, not for a timing number.

**§11 "Binary size" — measuring "with `--trim` on both" measures nothing.**
`--trim` is a no-op in 1.4.4, as shown above. Report the plain `--compile` size
and, if trim becomes real on a later Bun, re-measure both.

**Unverified rather than wrong:** `DESIGN.md` claims cold start under 300 ms and
idle RAM comparable to a bare `WKWebView` app. This probe measured 3.97–5.76 ms
to the first printed line for a compiled binary that opens no window, and
`Bun.serve` adds ~0.4 ms. Both numbers are far inside the bar, but neither
includes `WKWebView`, so the claim is untouched — it stands or falls on the M0
spike, and nothing here should be read as confirming it.
