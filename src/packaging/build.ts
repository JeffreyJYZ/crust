/**
 * Compile the app's entry with Bun, then assemble the bundle around it. Measured (the design page (`site/app/docs/design/page.mdx`), `research/packaging.md` §1): stable 1.4.4 accepts `--trim` and strips nothing (byte-identical output), and 161 KiB of extra entry functions moved it that much — so the honest claim is "no bundled Chromium", not "small": the floor is Bun plus JavaScriptCore, roughly ten times Tauri's.
 *
 * `--aot` is a `bun build` flag, not a `bun compile` subcommand; stable 1.4.4 accepts it but
 * produces a byte-identical binary (examples/hello: 89,820,386 B both ways), so it is kept free.
 */

import { chmod, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { resolveSidecar, SIDECAR_MANIFEST } from "@/plugins/sidecar";
import { supportsAot } from "./aot";
import { assembleApp, bundlesApp, type AssembleAppOptions, type AssembledApp } from "./app";
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
	/** Project root that relative `sidecars` paths resolve against. Defaults to cwd. */
	projectDir?: string;
	/** Relative paths of binaries to ship beside the app's executable (0755). */
	sidecars?: readonly string[];
	/** Print the two size lines as the build runs. Defaults to true. */
	verbose?: boolean;
}

export interface BuildResult {
	binaryPath: string;
	binaryBytes: number;
	entry: string;
	/** The assembled `.app`, present only where the shipping product is a bundle (darwin). */
	assembled?: AssembledApp;
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
 * Compile, then assemble a bundle on darwin only. Does not sign. Two numbers, reported separately on purpose: the compiled binary is what `bun build` produced, the assembled bundle is what a recipient's disk gives up — one number for both would hide which half grew.
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
	// nothing (byte-identical, measured). Canary bought 85.27 MiB -> 53.10 MiB on
	// examples/hello, but stable 1.4.4 accepts `--aot` with no size change at all, so the
	// flag is kept as a free future-proofing, not claimed as a win today. AOT is not
	// faster (215.2 ms vs 211.9 ms on a 300M loop), so that buys size alone, and
	// `--aot-allow-code-from-disk` costs 4.14 MiB so it is added only on the retry after
	// AOT refuses a dynamic `import()` — the one case it exists for.
	// AOT is a `bun build --compile` flag, not a `bun compile` subcommand — the latter
	// does not exist on stable 1.4.4 and was the whole reason the old probe failed.
	const aot = supportsAot();
	const args = ["bun", "build", "--compile", "--trim", ...(aot ? ["--aot"] : [])];
	const out = ["--outfile", binaryPath, options.entry];

	if (!aot) {
		await runOrThrow([...args, ...out]);
	} else {
		const first = Bun.spawnSync([...args, ...out], { stdout: "inherit", stderr: "pipe" });
		const complaint = first.stderr ? new TextDecoder().decode(first.stderr) : "";
		if (first.exitCode === 0) {
			// nothing further
		} else if (/dynamic (import|path)|aot-allow-code-from-disk/.test(complaint)) {
			console.log(
				"  aot       the entry imports code at run time, so this build allows it from disk (+4.1 MiB)",
			);
			await runOrThrow([...args, "--aot-allow-code-from-disk", ...out]);
		} else {
			throw new Error(
				`bun build --compile --aot failed (exit ${first.exitCode}):\n${complaint.trim()}`,
			);
		}
	}

	const written = await compiledBinary(binaryPath);
	if (written === undefined) {
		throw new Error(
			`bun wrote no binary at ${binaryPath}${process.platform === "win32" ? ` or ${binaryPath}.exe` : ""}`,
		);
	}
	const binaryBytes = (await stat(written)).size;
	const assembled = bundlesApp(process.platform)
		? await assembleApp({ ...options.app, binary: written, outDir })
		: undefined;
	// On macOS the executable sits in `Contents/MacOS` and the manifest in `Contents/Resources`:
	// a JSON file beside the executable is nested code to codesign and breaks the ad-hoc seal.
	// Off darwin the flat binary's own directory holds both.
	const executablePath = assembled?.executablePath ?? written;
	await copySidecars({
		names: options.sidecars ?? [],
		projectDir: options.projectDir ?? process.cwd(),
		targetDir: dirname(executablePath),
		manifestDir: assembled ? join(dirname(dirname(executablePath)), "Resources") : undefined,
	});

	if (options.verbose !== false) {
		console.log(
			`binary    ${formatBytes(binaryBytes).padStart(9)}  ${binaryBytes} bytes  ${written}`,
		);
		if (assembled) {
			console.log(
				`assembled ${formatBytes(assembled.assembledBytes).padStart(9)}  ` +
					`${assembled.assembledBytes} bytes  ${assembled.appPath}`,
			);
		}
	}

	return {
		...(assembled ? { assembled } : {}),
		binaryPath: written,
		binaryBytes,
		entry: options.entry,
	};
}

/**
 * Bun appends `.exe` on Windows when the outfile carries no extension, so the path it actually wrote is read back rather than assumed — a wrong guess is an `ENOENT` on the one host where nobody can see the build.
 */
async function compiledBinary(path: string): Promise<string | undefined> {
	for (const candidate of [path, `${path}.exe`]) {
		const info = await stat(candidate).catch(() => undefined);
		if (info?.isFile() === true && info.size > 0) return candidate;
	}
	return undefined;
}

/**
 * Copy each declared sidecar into the directory holding the executable, preserving its relative
 * path (`bin/ffmpeg` lands in `<binary dir>/bin/ffmpeg`, which is the name the plugin resolves).
 * The file is chmod 0755 so a copy that crossed a medium losing modes still launches.
 */
export async function copySidecars(options: {
	names: readonly string[];
	projectDir: string;
	targetDir: string;
	/**
	 * Where the manifest goes. macOS passes `Contents/Resources`: codesign treats every file in
	 * `Contents/MacOS` as nested code and refuses a JSON document there, so the manifest beside the
	 * executable failed the ad-hoc sign on every packaged build.
	 */
	manifestDir?: string;
}): Promise<void> {
	for (const name of options.names) {
		const source = resolveSidecar(options.projectDir, name);
		if (source === undefined) {
			throw new Error(
				`sidecar ${JSON.stringify(name)} is not a relative path inside the project`,
			);
		}
		const info = await stat(source).catch(() => undefined);
		if (!info?.isFile()) {
			throw new Error(`sidecar ${JSON.stringify(name)} does not exist at ${source}`);
		}
		const target = resolve(options.targetDir, ...name.split(/[\\/]/));
		await mkdir(dirname(target), { recursive: true });
		await copyFile(source, target);
		await chmod(target, 0o755);
	}
	// The runtime plugin reads this manifest to learn which names were declared, so a
	// page-spawned name that was not copied (or a stale name) is refused by name.
	const manifestDir = options.manifestDir ?? options.targetDir;
	await mkdir(manifestDir, { recursive: true });
	await writeFile(join(manifestDir, SIDECAR_MANIFEST), JSON.stringify(options.names), "utf8");
}
