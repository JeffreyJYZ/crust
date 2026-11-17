# Lane W — the four power events crust was missing

- `116_power_events.c`: six kinds (1 sleep, 2 lock, 3 wake, 4 screensleep, 5 screenwake, 6 unlock) from ONE `pw_watches` table (kind, name, selector, imp, centre). One `CrustPowerObserver` registers every row, so class builder and `crust_power_watch` cannot drift; an unknown kind answers 0. Lock/unlock on `NSDistributedNotificationCenter`, the other four on `NSWorkspace`'s.
- `power-subscriptions.ts` (new) is the JS twin: one row per event, `powerSubscribeHandlers()` builds all six so `power.ts` spreads them instead of repeating six handlers.
- `POWER_EVENTS`, `POWER_EVENT_KIND`, `PowerAdapter`, `DarwinPowerAdapter` carry all six; each refuses `not-implemented` naming its notification on a platform without it.
- Trap: a registered observer is harmless, so `crust_power_watch(3..6)` is asserted live — proves the names resolve on this OS, not just that C compiles.
- Trap: `bun fmt` alone would not keep `power.ts` under 200; the handler table is what gave the room back. `power-events.test.ts` split into `power-events-refusal.test.ts` for the same cap.
- Not mine: `butter-coverage.md` F4 row and the parity page belong to Lane Y; F4 is now fully addressed in source.
