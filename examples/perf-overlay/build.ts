/**
 * Two build paths for the probe. Dev bundles the overlay as its own module; production bundles
 * only the page's workload entry. The marker search in production.test.ts is a byte search of the
 * output, not a config read, so "not in production" is a fact about emitted files.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const here = import.meta.dir;
const entry = resolve(here, "overlay-entry.ts");
const page = resolve(here, "public/app.js");

export async function buildOverlay(): Promise<string> {
	const dir = mkdtempSync(resolve(tmpdir(), "crust-overlay-dev-"));
	try {
		const result = await Bun.build({
			entrypoints: [entry],
			outdir: dir,
			target: "browser",
			format: "esm",
			minify: false,
		});
		if (!result.success) throw new Error(`overlay build failed: ${result.logs.join("\n")}`);
		const output = result.outputs[0];
		if (output === undefined) throw new Error("overlay build emitted nothing");
		return readFileSync(output.path, "utf8");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export async function buildProduction(outdir: string): Promise<string[]> {
	const result = await Bun.build({
		entrypoints: [page],
		outdir,
		target: "browser",
		format: "esm",
		minify: true,
	});
	if (!result.success) throw new Error(`production build failed: ${result.logs.join("\n")}`);
	return result.outputs.map((output) => output.path);
}
