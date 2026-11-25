/**
 * Canonical implementation lives under `src/cli/perf/command.ts` — the shipped CLI needs it, so
 * it cannot live behind this boundary. This barrel keeps every e2e caller's surface unchanged.
 */
export { runCommand, type RunOptions, type RunResult } from "../../src/cli/perf/command.ts";
