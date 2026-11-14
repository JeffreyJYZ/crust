/**
 * Compile the app's entry with Bun, then assemble the bundle around it. Measured (the design page (`site/app/docs/design/page.mdx`), `research/packaging.md` §1): stable 1.4.4 accepts `--trim` and strips nothing (byte-identical output), and 161 KiB of extra entry functions moved it that much — so the honest claim is "no bundled Chromium", not "small": the floor is Bun plus JavaScriptCore, roughly ten times Tauri's.
 */

import { mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assembleApp, type AssembleAppOptions, type AssembledApp } from "./app";
import { runOrThrow } from "./exec";

export interface BuildOptions {
	/** Bun entry file to compile, e.g. `src/index.ts`. */
	entry: string;
	/** Filename inside `Contents/MacOS/`, e.g. `crust-app`. */
	binaryName: string;
	/** Directory for both the compiled binary and the `.app`. Defaults to `dist`. */
	outDir?: string;
	/** Bundle metadata; `binary` and `outDir` are supplied by this function. */
	app: Omit<AssembleAppOptions, "binary" | "outDir">;
	/** Print the two size lines as the build runs. Defaults to true. */
	verbose?: boolean;
}

export interface BuildResult extends AssembledApp {
	binaryPath: string;
	binaryBytes: number;
	entry: string;
}

/** Byte count the way the docs quote it. `MiB` is 1,048,576 bytes. */
export function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
	}
	if (bytes >= 1024) {
		return `${(bytes / 1024).toFixed(1)} KiB`;
	}
	return `${bytes} B`;
}

/**
 * Compile and assemble. Does not sign. Two numbers, reported separately on purpose: the compiled binary is what `bun build` produced, the assembled bundle is what a recipient's disk gives up — one number for both would hide which half grew.
 */
export async function buildApp(options: BuildOptions): Promise<BuildResult> {
	const outDir = resolve(options.outDir ?? "dist");
	const binaryPath = join(outDir, options.binaryName);

	const entryStat = await stat(options.entry).catch(() => undefined);
	if (!entryStat?.isFile()) {
		throw new Error(`entry ${options.entry} does not exist`);
	}
	await mkdir(outDir, { recursive: true });

	// `--trim` always; whether it bites depends on the interpreter. Stable 1.4.4 strips
	// nothing (byte-identical, measured), while a Bun carrying `bun compile` — canary
	// 1.4.5 and 1.5 — is worth 85.27 MiB to 53.10 MiB on examples/hello. AOT is not
	// faster (215.2 ms vs 211.9 ms on a 300M loop), so that buys size alone, and
	// `--aot-allow-code-from-disk` costs 4.14 MiB so it is added only on the retry after
	// AOT refuses a dynamic `import()` — the one case it exists for.
	const aot =
		Bun.spawnSync(["bun", "compile", "--help"], {
			stdout: "ignore",
			stderr: "ignore",
		}).exitCode === 0;

	if (!aot) {
		await runOrThrow([
			"bun",
			"build",
			"--compile",
			"--trim",
			"--outfile",
			binaryPath,
			options.entry,
		]);
	} else {
		const args = ["compile", "--trim", "--outfile", binaryPath, options.entry];
		const first = Bun.spawnSync(["bun", ...args], { stdout: "inherit", stderr: "pipe" });
		const complaint = first.stderr ? new TextDecoder().decode(first.stderr) : "";
		if (first.exitCode === 0) {
			// nothing further
		} else if (/dynamic (import|path)|aot-allow-code-from-disk/.test(complaint)) {
			console.log(
				"  aot       the entry imports code at run time, so this build allows it from disk (+4.1 MiB)",
			);
			await runOrThrow([
				"bun",
				"compile",
				"--trim",
				"--aot-allow-code-from-disk",
				"--outfile",
				binaryPath,
				options.entry,
			]);
		} else {
			throw new Error(`bun compile failed (exit ${first.exitCode}):\n${complaint.trim()}`);
		}
	}

	const binaryBytes = (await stat(binaryPath)).size;
	const assembled = await assembleApp({ ...options.app, binary: binaryPath, outDir });

	if (options.verbose !== false) {
		console.log(
			`binary    ${formatBytes(binaryBytes).padStart(9)}  ${binaryBytes} bytes  ${binaryPath}`,
		);
		console.log(
			`assembled ${formatBytes(assembled.assembledBytes).padStart(9)}  ` +
				`${assembled.assembledBytes} bytes  ${assembled.appPath}`,
		);
	}

	return { ...assembled, binaryPath, binaryBytes, entry: options.entry };
}
