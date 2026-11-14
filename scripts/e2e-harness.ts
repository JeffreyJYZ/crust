/**
 * Shared plumbing for the end-to-end proofs (`e2e*.ts`, `e2e-dev*`, the tray
 * probe's siblings).
 *
 * Every proof needs the same four things: a PASS/FAIL line per assertion, a
 * child bounded by a real deadline, a way to prove nothing survives, and one
 * exit code. None of that knows anything about crust, so it lives here once.
 *
 * This file is the import path those scripts use, and every name is re-exported
 * so a split module never moves the surface: `Verdict`, `runCommand`,
 * `clearSurvivors`, `survivorsOf`, `probe` and the two probe types.
 */
export { type Assertion, runCommand, type RunResult, Verdict } from "./harness/verdict.ts";
export { clearSurvivors, survivorsOf } from "./harness/process.ts";
export { type Probe, type ProbeOptions, probe } from "./harness/probe.ts";
