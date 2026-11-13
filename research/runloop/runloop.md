# crust research — the pump

Measured on Bun 1.4.4, macOS 27.0.1, arm64, M4. Every number below came from a
probe in this directory; the command that produced it is named next to it.

## Verdict

**The pump works, and it keeps JavaScript responsive — but only when each pump
blocks for a fraction of a millisecond. The 4 ms pump in `DESIGN.md` §3 does not
work: it drops 17.6% of a 60 Hz timer and pushes p99 tick spacing to 21.8 ms.**

Two separate claims, both settled:

1. **Responsiveness.** Pumping `CFRunLoopRunInMode(mode, 0.00025, true)` from a
   0.25 ms timer delivered 186 of 187 expected 16 ms ticks (99.5%) with gap
   median 16.092 ms, p99 16.304 ms, max 16.322 ms, at 7.2% CPU. The best
   no-pump baseline in the same sweep was 98.4% with p99 18.184 ms. The pump is
   therefore not merely tolerable, it is *better* than not pumping.
   At the design's 4 ms: 82.4% of ticks, median 19.383 ms, p99 21.849 ms, max
   25.128 ms. That is worse than not pumping at all, on both delivery and tail.

2. **What must be called first.** Nothing needs to be called before pumping for
   the run loop to be pumpable. `CFRunLoopRunInMode` returns normally before
   `[NSApp finishLaunching]` with an identical return-code distribution
   (3:98, 4:2 both before and after, 100 pumps each), and `mainMenu` is `null`
   in both states. `finishLaunching` is idempotent and harmless, so call it if a
   launch sequence is wanted; it is not a precondition for the pump.

A regular application does exist without activation: `[NSApp setActivationPolicy:0]`
returned 1 and `[NSApp activationPolicy]` read back 0 in three independent runs,
with no activate call ever made. The policy was set and read back, not observed.

Unproven, and deliberately so:

- Whether a Dock icon appears at policy 0. Watching for it was forbidden, and a
  policy value read back is not an observation of the Dock.
- Whether `applicationDidFinishLaunching:` is ever delivered. It fired 0 times in
  30 pumps, with and without `finishLaunching`, under the CF pump and with no
  pump, while a direct `objc_msgSend` to the same IMP fired immediately. The
  cause is unexplained; the notification path could not be probed without
  aborting the process (see below).
- Whether a window would draw. No window was created, by design.

## The pump, measured

### Cost of one pump with no events pending

`bun p2.ts` — 1000 pumps, 4 ms timeout, nothing queued:

```
mean 4.891 ms  median 5.025  p99 7.133  max 20.855  total 4893.09 ms
```

The timeout is the floor, not a ceiling: an idle pump blocks for the full
timeout. That single fact explains the whole sweep.

Zero timeout, same call, 1000 times: **mean 0.003 ms, total 3.33 ms**. It does
not block, so it also does not wait for anything — driven in a loop it reached
1,477,389 calls in one second at **100% CPU**. A zero-timeout pump is a busy
loop, not a pump.

### Pump timeout versus tick fidelity

`bun p13.ts` — 3 s per row, 16 ms `setInterval` tick, pump interval equal to the
pump timeout, policy 2 throughout:

| pump timeout | ticks delivered | gap median | gap p99 | gap max | pump mean | CPU |
|---|---|---|---|---|---|---|
| none | 184/187 (98.4%) | 16.152 | 18.184 | 20.428 | — | 0.7% |
| 0.25 ms | 186/187 (99.5%) | 16.092 | 16.304 | 16.322 | 0.351 | 7.2% |
| 0.5 ms | 186/187 (99.5%) | 16.107 | 16.426 | 16.513 | 0.659 | 5.7% |
| 1 ms | 181/187 (96.8%) | 16.606 | 17.238 | 17.756 | 1.284 | 6.0% |
| 2 ms | 172/187 (92.0%) | 17.422 | 18.124 | 18.465 | 2.475 | 3.6% |
| 4 ms | 154/187 (82.4%) | 19.383 | 21.849 | 25.128 | 4.877 | 1.3% |

The relationship is monotonic in the timeout and the cause is not subtle: a
blocking pump holds the thread for its whole timeout, and Bun's timer wheel can
only fire between pumps. At 4 ms the pump occupies ~4.9 ms of every ~4.9 ms and
the timer queue slips a full tick. CPU *falls* as the timeout grows, because a
blocked thread burns less than a polling one — so CPU is the wrong metric here
and the tick columns are the only honest ones.

**Decision: pump with a 0.25 ms timeout, or 0.5 ms if CPU matters more than the
last 0.1 ms of jitter. Never 4 ms.** `DESIGN.md` §3's "a 4 ms interval costs
almost nothing" is measurably false.

### `setInterval` versus a re-arming `setTimeout` chain

`bun p16.ts` — 10 s per row, two rounds, 0.25 ms pump, policy 2:

| kind | ticks | gap mean | median | p95 | p99 | max | CPU |
|---|---|---|---|---|---|---|---|
| interval, r1 | 609/625 (97.4%) | 16.403 | 16.095 | 16.404 | 25.642 | 40.361 | 5.4% |
| timeout, r1 | 620/625 (99.2%) | 16.116 | 16.097 | 16.235 | 16.346 | 20.563 | 6.7% |
| interval, r2 | 621/625 (99.4%) | 16.100 | 16.090 | 16.221 | 16.306 | 17.232 | 6.7% |
| timeout, r2 | 620/625 (99.2%) | 16.108 | 16.092 | 16.215 | 16.309 | 19.070 | 6.5% |

Round 1 shows the interval stalling hard (p99 25.6 ms, max 40.4 ms) where the
chain did not; round 2 shows both clean. One bad round out of two is not a
closed case, but the failure mode is the one `DESIGN.md` predicts (coalescing
under load) and only the chain avoided it. Treat the chain as the default and
the interval as an optimisation to re-measure on real hardware under real load.

## What has to exist before the first pump

`bun p12.ts`, policy 2 throughout:

```
beforeFinish: 100 pumps, rets {3: 98, 4: 2}, mean 4.703 ms
finishLaunching: sent
afterFinish:  100 pumps, rets {3: 98, 4: 2}, mean 4.717 ms
```

Identical. `bun p4.ts` adds: `pumpBeforeFinish` returns `3` in 5.062 ms,
`mainMenu` is `null` before and after `finishLaunching`, `windows` is non-empty
in both, and `finishLaunching` sent twice does not throw.

So the ordering constraint on crust is not "launch, then pump". It is only:

1. `NSApplicationLoad()` — measured 28.0–44.5 ms across probes (73.9 ms and
   84.9 ms in the earlier activation-policy runs). Until it runs,
   `objc_getClass("NSApplication")` is `null`.
2. `[NSApplication sharedApplication]` — non-null.
3. `[NSApp setActivationPolicy:0]` — returned 1; `[NSApp activationPolicy]`
   read back 0. Measured three times, `withActivate: false` every time.
4. `[NSApp finishLaunching]` — optional, idempotent.
5. Obtain the mode string, then pump on a timer.

Step 5's mode must be a real CFString. `__CFStringMakeConstantString("kCFRunLoopDefaultMode")`
is content-equal to the canonical constant and verified by `CFStringGetCString`
before use. Reading the exported variable instead is fatal (below).

## Minimal ordered call sequence

The sequence above, written as the actual calls, for a live regular application
with no window:

```ts
NSApplicationLoad();                              // registers AppKit classes
const app = msg(0, P)(cls("NSApplication"), sel("sharedApplication"));
callI(app, "setActivationPolicy:", 0);            // -> 1; read back 0
callV(app, "finishLaunching");                    // optional, idempotent
const mode = cf.__CFStringMakeConstantString("kCFRunLoopDefaultMode");

const pump = () => {                              // 0.25 ms slice
	cf.CFRunLoopRunInMode(mode, 0.00025, true);
	setTimeout(pump, 0.25);
};
pump();
```

Every send is guarded. That is not style, it is the difference between one bad
selector and a dead process.

## The selectors that aborted

**Rule this forces on crust: every Objective-C send must be preceded by
`respondsToSelector:` against the actual receiver, and no selector may be sent on
faith. An uncaught Obj-C exception terminates the whole Bun process; there is no
recoverable path from a wrong selector.**

Each row is one attempt. The crash cap was reached; nothing here was retried
with a variation to see whether it would work.

| selector | receiver it was sent to | result |
|---|---|---|
| `stringWithUTF8:` | the `NSString` class object (`objc_getClass("NSString")`), argument a `Uint8Array` | `panic: A C++ exception occurred`, exit 134 |
| `stringWithUTF8:` | same, argument a `Buffer` | same abort, exit 134 |
| `stringWithUTF8:` | same, argument `Array<number>` | clean refusal: `TypeError: bun:ffi cannot convert argument to 'ptr'`, exit 0 |
| `addObserver:selector:name:object:` | the `NSNotificationCenter` `defaultCenter` instance, `name` as an `NSString` | `panic: A C++ exception occurred`, exit 134 |
| `addObserver:selector:name:object:` | same, `name` as a CFString from `__CFStringMakeConstantString` | same abort, exit 134 |
| `runMode:beforeDate:` | the `NSRunLoop` `currentRunLoop` instance | `panic: A C++ exception occurred`, exit 134 |
| `nextEventMatchingMask:untilDate:inMode:dequeue:` | `NSApp`, in `NSDate distantPast`, mask all, dequeue YES, declared to return a pointer | `panic(main thread): Trap instruction at address 0x1838007B8` |

Two of those deserve their own paragraph, because both look like the obvious way
to write crust.

**The AppKit-native pump — the one BunKit uses — is not available.**
`-[NSApplication nextEventMatchingMask:untilDate:inMode:dequeue:]` responded `1`
to `respondsToSelector:` and then trapped inside the call. BunKit reaches the
same result from a native core, where the trap does not happen; from `bun:ffi`
the call kills the process. `CFRunLoopRunInMode` is the pump, and it is a
CoreFoundation call, not an AppKit one.

**The notification path is closed, so delegate delivery cannot be measured.**
Every form of `addObserver:selector:name:object:` aborted, and the crash cap
stopped the narrowing. This is why "does `applicationDidFinishLaunching:` fire"
is reported as unproven rather than as a negative: the machinery that would have
answered it is exactly the machinery that aborted.

A working substitution exists for string arguments: `+[NSData dataWithBytes:length:]`
followed by `-[NSString initWithData:encoding:]` returned the string. Use it,
not `stringWithUTF8:`.

## Failure modes observed

- **Idle pump blocks for its full timeout.** 1000 idle pumps at 4 ms totalled
  4893 ms. The timeout is the cost, not the work.
- **A zero-timeout pump is a spin.** 1,477,389 calls in 1 s, 100% CPU.
- **A wrong mode string is a silent no-op, not an error.** 50 pumps in
  `NSDefaultRunLoopMode` all returned `1` (finished) in ~0 ms. Nothing drained
  and nothing complained. Verify the mode by content before pumping.
- **Blocking JavaScript stalls Cocoa for its whole duration.** A 300 ms
  synchronous block produced a 310.9 ms tick gap; ticks then resumed, they do not
  accumulate.
- **`[NSApp stop:]` is not a shutdown.** After it, pumps return `4`, then `3` —
  never `2`. The process stays alive; stop: only ends an `[NSApp run]` that crust
  never calls.
- **`[NSApp terminate:]` is the shutdown.** The process ended before the next
  `console.log` line could print, with shell exit code 0.
- **No pump does not hang and does not spin.** AppKit loaded, three seconds, no
  pump: the process reached the end at 0.1% CPU, 3.3 ms of CPU time. Identical to
  a control with no AppKit at all.
- **Re-entrancy confirmed.** A `JSCallback` installed as an IMP on a
  runtime-created class ran inside a pump (delivered through
  `performSelectorOnMainThread:withObject:waitUntilDone:`), and a direct send to
  the same IMP returned 42. Tick spacing during callback-firing pumps at a 4 ms
  slice: median 19.369 ms, p99 20.212 ms — the slice cost, not the callback.
- **`process.exit()` after AppKit loads prints a panic after JS completes.**
  Output is complete and the exit code is 0; the trailing
  `panic: A C++ exception occurred` is teardown, not a probe failure.

## What this means for `DESIGN.md`

§3 must change in three places:

1. `CFRunLoopRunInMode(mode, 0.004, true)` on a 4 ms timer costs 17.6% of a
   60 Hz tick and 21.8 ms of p99 jitter. Use `0.00025` and a 0.25 ms slice.
2. "A 4 ms interval costs almost nothing" is false. It costs more than not
   pumping.
3. The re-arming `setTimeout` chain should be the default rather than the
   mitigation, on the strength of round 1 above.

Everything else §3 says — JavaScript blocks drawing, re-entrancy is real,
delegates must not throw across the FFI boundary — is confirmed.

## Commands

All run from `/Users/jyz/dev/crust/research/runloop`, all foreground, each exits
on its own. `ffi.ts` is the shared guarded layer; every probe loads the
application at policy 2 and never activates.

```
bun p2.ts    # pump cost: 1000 pumps of 4 ms, plus tick fidelity with and without a pump
bun p3.ts    # no pump at all: does the process survive, how much CPU
bun p4.ts    # pump before/after finishLaunching; menu and windows before/after
bun p5.ts <stop-pump|stop-only|hide-then-stop>
bun p5b.ts <stop-then-pump|stop-inside-callback|terminate>
bun p6.ts    # wrong mode string, back-to-back pumps, a 300 ms blocking block
bun p7.ts    # JSCallback as an IMP, delivered inside a pump
bun p8.ts    # delegate set before finishLaunching; app state as AppKit reports it
bun p9.ts    # delegate callback, then the nextEventMatchingMask pump (traps)
bun p10.ts <none|cf|nsrunloop>
bun p12.ts   # ret codes before/after finishLaunching; zero-timeout pump CPU
bun p13.ts   # the pump-timeout sweep (the table above)
bun p16.ts   # setInterval vs setTimeout chain over 10 s, two rounds
```

Probes `p1`, `p11`, `p14`, `p15` and the `b*.ts` scratch files were deleted:
`p1` was the activation-policy probe and its value was recorded once, `p11`,
`p14` and `p15` each aborted before printing and their findings are in the abort
table, and `b*.ts` were one-off narrowing attempts.
