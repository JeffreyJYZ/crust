/**
 * Shared plumbing for the end-to-end proofs: a PASS/FAIL line per assertion, a child bounded by a real deadline, a way to prove nothing survives, and one exit code. None of it knows anything about crust, so it lives here once.
 * Every name is re-exported through this file, so splitting a module never moves the surface for its importers.
 */
export { type Assertion, runCommand, type RunResult, Verdict } from "./harness/verdict.ts";
export { clearSurvivors, survivorsOf } from "./harness/process.ts";
export { type Probe, type ProbeOptions, probe } from "./harness/probe.ts";
