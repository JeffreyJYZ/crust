#!/usr/bin/env bun
/**
 * Compile the native example's sources with the repo's own pipeline: `compileExtension` picks the
 * toolchain and argv, `writeBindings` generates the `bun:ffi` module beside the dylib. Nothing here
 * shells a compiler itself, so this script and a future build step cannot disagree about the argv.
 *
 * The output lands in `examples/native/extensions/generated/`, which is build output: the extension
 * files import it, and a machine with no toolchain gets one named failure per source instead of a
 * half-written module.
 */
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type SymbolSpec, writeBindings } from "../src/packaging/extension-bindings.ts";
import { compileExtension } from "../src/packaging/extension-compile.ts";

const REPO = resolve(import.meta.dir, "..");
const EXAMPLE = join(REPO, "examples/native");
const NATIVE = join(EXAMPLE, "native");
const OUT = join(EXAMPLE, "extensions/generated");

/** Both dylibs export the same three symbols, so one spec list describes each pair. */
const SYMBOLS: SymbolSpec[] = [
	{ name: "now_ms", args: [], returns: "f64" },
	{ name: "ran_for_ms", args: ["f64", "f64"], returns: "f64" },
	{ name: "ticks_between", args: ["f64", "f64", "f64"], returns: "u32" },
];

interface Plan {
	/** Source under `native/`. */
	source: string;
	/** Extension name, which is also the generated module's name. */
	name: string;
	/** The emitted dylib's file name: `rustc` prefixes a cdylib with `lib`. */
	dylib: string;
}

const PLAN: Plan[] = [
	{ source: "clock.zig", name: "zigclock", dylib: "clock.dylib" },
	{ source: "clock.rs", name: "rustclock", dylib: "libclock.dylib" },
];

async function build(plan: Plan): Promise<boolean> {
	const file = join(NATIVE, plan.source);
	const result = await compileExtension({ file, outDir: OUT });
	if (!result.ok) {
		console.log(`  ${plan.name}  FAILED  ${result.reason}`);
		return false;
	}
	// `compileExtension` already emitted into `OUT`, and the generated module opens its dylib from
	// its own directory, so the dylib and the module end up side by side with no copy in between.
	await writeBindings({ outDir: OUT, name: plan.name, symbols: SYMBOLS, dylib: plan.dylib });
	console.log(`  ${plan.name}  ${result.tool} -> ${result.output}`);
	return true;
}

async function main(): Promise<number> {
	await rm(OUT, { recursive: true, force: true });
	await mkdir(OUT, { recursive: true });
	console.log(`native extensions  ${PLAN.length} source(s) in ${NATIVE}`);

	let failed = 0;
	for (const plan of PLAN) if (!(await build(plan))) failed += 1;
	if (failed > 0) {
		console.log(
			`\n${failed} of ${PLAN.length} failed — install the missing toolchain, or see crust doctor`,
		);
		return 1;
	}
	console.log(`\nwrote ${OUT}`);
	return 0;
}

process.exit(await main());
