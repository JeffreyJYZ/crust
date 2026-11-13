import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cc, FFIType } from "bun:ffi";
import { startBridge } from "@/bridge/server.ts";
import { type CrustConfig, loadConfig } from "@/config";
import { describeSignature } from "@/packaging/sign";
import {
	crustRoot,
	exists,
	findAppBundle,
	line,
	resolveBackendEntry,
	type CliOptions,
} from "./util.ts";

type Status = "ok" | "fail" | "note";

interface Check {
	name: string;
	status: Status;
	detail: string;
}

async function shellOutput(command: string[]): Promise<string | undefined> {
	try {
		const child = Bun.spawn({ cmd: command, stdout: "pipe", stderr: "pipe" });
		const text = await new Response(child.stdout).text();
		await child.exited;
		return text.trim();
	} catch {
		return undefined;
	}
}

/** Compare dotted version strings numerically, e.g. "13.0" against "14.1.2". */
function versionAtLeast(version: string, minimum: string): boolean {
	const a = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const b = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const left = a[index] ?? 0;
		const right = b[index] ?? 0;
		if (left !== right) return left > right;
	}
	return true;
}

/**
 * `cc()` the shipped shim once, exactly as the platform does at launch.
 *
 * This is the check a user cannot do by reading the project: TinyCC compiling
 * C with four frameworks linked is the step that fails when the macOS toolchain
 * is missing or the shim has been edited into something C cannot parse. It has
 * no side effects — no window, no application activation.
 */
async function checkShim(): Promise<Check> {
	const source = resolve(crustRoot, "src/platform/darwin/shim.c");
	if (!(await exists(source))) {
		return { name: "shim", status: "fail", detail: `missing ${source}` };
	}
	try {
		cc({
			source,
			flags: [
				"-framework",
				"AppKit",
				"-framework",
				"Foundation",
				"-framework",
				"WebKit",
				"-framework",
				"CoreFoundation",
			],
			symbols: {
				shim_app_load: { args: [], returns: FFIType.i32 },
				shim_window_new: {
					args: [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
					returns: FFIType.ptr,
				},
			},
		});
		return { name: "shim", status: "ok", detail: `${source} compiles with cc()` };
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return {
			name: "shim",
			status: "fail",
			detail: `${source} does not compile — ${text.replaceAll("\n", " | ")}`,
		};
	}
}

/**
 * Bind the bridge on an ephemeral port and answer one invoke through it.
 *
 * Binding is the failure mode a config check cannot see: a listener that cannot
 * start is why an app opens a blank window. The port is released before doctor
 * returns, so this leaves nothing running.
 */
async function checkBridge(): Promise<Check> {
	try {
		const bridge = startBridge({ handlers: { "__doctor.ping": () => "pong" } });
		try {
			const response = await fetch(`${bridge.url}/_crust/invoke`, {
				method: "POST",
				headers: {
					origin: `http://127.0.0.1:${bridge.port}`,
					authorization: `Bearer ${bridge.token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ plugin: "__doctor", command: "ping", args: null }),
			});
			const text = await response.text();
			if (response.status !== 200 || !text.includes("pong")) {
				return {
					name: "bridge",
					status: "fail",
					detail: `bound ${bridge.url} but invoke answered ${response.status}: ${text.slice(0, 160)}`,
				};
			}
			return {
				name: "bridge",
				status: "ok",
				detail: `bound ${bridge.url}, invoke answered "pong"`,
			};
		} finally {
			await bridge.stop();
		}
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return { name: "bridge", status: "fail", detail: `cannot bind — ${text}` };
	}
}

const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".c",
	".m",
]);
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".crust", ".cache", ".turbo"]);
const MAX_SCANNED_BYTES = 512 * 1024;

async function projectSources(dir: string, prefix = ""): Promise<string[]> {
	const entries = await readdir(join(dir, prefix), { withFileTypes: true }).catch(() => []);
	const files: string[] = [];
	for (const entry of entries) {
		const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
			files.push(...(await projectSources(dir, relative)));
			continue;
		}
		if (!entry.isFile()) continue;
		const dot = entry.name.lastIndexOf(".");
		if (dot === -1) continue;
		if (SOURCE_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) files.push(relative);
	}
	return files;
}

/**
 * The three traps DESIGN.md §2 records as fatal, detected in the project's own
 * code. Each is named when it is hit, with the line that hit it: a user who
 * copied a snippet that passed a JS string into C needs to see why the process
 * died with no JavaScript error, not a generic "window did not open".
 */
async function scanTraps(dir: string): Promise<Check[]> {
	const checks: Check[] = [];
	const files = await projectSources(dir);

	for (const relative of files) {
		const path = join(dir, relative);
		const info = await Bun.file(path)
			.stat()
			.catch(() => undefined);
		if (!info?.isFile() || info.size > MAX_SCANNED_BYTES) continue;
		const text = await Bun.file(path)
			.text()
			.catch(() => "");
		if (text.includes("\u0000")) continue;
		const lines = text.split("\n");

		const allocInit = lines.findIndex(
			(source) =>
				/\[\s*[A-Za-z_]\w*\s+alloc\s*\]\s*init\b/.test(source) ||
				(/\balloc\b/.test(source) &&
					/\binit\b/.test(source) &&
					/sel_registerName|objc_msgSend/.test(source)),
		);
		if (allocInit !== -1) {
			checks.push({
				name: "trap",
				status: "fail",
				detail:
					`${relative}:${allocInit + 1} sends init to an allocated NSWindow — ` +
					"[[NSWindow alloc] init] aborts the process from AppKit's own thread; " +
					"build the rect in C and call initWithContentRect: instead",
			});
		}

		const stringSend = lines.findIndex(
			(source) =>
				/\bstringWithUTF8String\s*:/.test(source) ||
				(/\bNSString\b/.test(source) && /\bcstring\b|\bptr\(/.test(source)),
		);
		if (stringSend !== -1) {
			checks.push({
				name: "trap",
				status: "fail",
				detail:
					`${relative}:${stringSend + 1} builds or passes a short ASCII NSString — ` +
					"it is a tagged pointer and cannot cross bun:ffi; keep the string in C " +
					"behind a handle",
			});
		}

		if (text.includes("FFIType.cstring")) {
			const literalCall = lines.findIndex(
				(source) =>
					/\.\w+\(\s*(["'])[^"'`\n]*\1\s*\)/.test(source) &&
					!/TextEncoder|new Uint8Array|Buffer\.from/.test(source),
			);
			if (literalCall !== -1) {
				checks.push({
					name: "trap",
					status: "note",
					detail:
						`${relative}:${literalCall + 1} may pass a JavaScript string where the ` +
						"shim expects const char * — a JS string cannot cross into compiled C; " +
						"pass ptr(new TextEncoder().encode(value))",
				});
			}
		}
	}

	return checks;
}

/**
 * `crust doctor` — report the state of everything the app needs, in the order
 * a failure actually happens: platform, runtime, config, shim, bridge, entry,
 * window layer, the known-fatal traps, bundle.
 */
export async function doctor(options: CliOptions): Promise<number> {
	const checks: Check[] = [];
	const push = (name: string, status: Status, detail: string): void => {
		checks.push({ name, status, detail });
	};

	// Platform.
	if (process.platform !== "darwin") {
		push("platform", "fail", `macOS only — this is ${process.platform}`);
	} else if (process.arch !== "arm64") {
		push("platform", "fail", `macOS arm64 only — this is ${process.arch}`);
	} else {
		push("platform", "ok", `darwin ${process.arch}`);
	}

	// Runtime.
	push("bun", "ok", `${Bun.version} at ${process.execPath}`);

	// macOS version floor, when the config asks for one.
	const osVersion = await shellOutput(["sw_vers", "-productVersion"]);

	// Config.
	let config: CrustConfig | undefined;
	try {
		const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
		config = loaded.config;
		push("config", "ok", loaded.path);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		push("config", "fail", text.replaceAll("\n", "\n            "));
	}

	if (config && osVersion) {
		const minimum = config.build?.minimumSystemVersion;
		if (!minimum) {
			push("macos", "ok", `${osVersion} (no minimumSystemVersion set)`);
		} else {
			push(
				"macos",
				versionAtLeast(osVersion, minimum) ? "ok" : "fail",
				`${osVersion}, build wants ≥ ${minimum}`,
			);
		}
	}

	// The C shim, compiled exactly as the platform compiles it at launch.
	const shim = await checkShim();
	push(shim.name, shim.status, shim.detail);

	// The loopback bridge: bind, answer one invoke, release the port.
	const bridge = await checkBridge();
	push(bridge.name, bridge.status, bridge.detail);

	// Dev server reachability, only when the config names one.
	if (config?.dev?.url) {
		const url = config.dev.url;
		const response = await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null);
		if (response) push("dev url", "ok", `${url} answered ${response.status}`);
		else push("dev url", "fail", `${url} did not answer — is the frontend dev server running?`);
	}

	// Backend entry: `src/main.ts` or `main.ts`, the same rule the CLI uses.
	const backend = await resolveBackendEntry(options.dir, options.entry);
	if (backend) push("backend", "ok", backend.path);
	else
		push(
			"backend",
			"fail",
			resolve(options.dir, options.entry ?? "src/main.ts") +
				" does not exist — expected src/main.ts or main.ts",
		);

	// Window layer.
	const platformPath = resolve(crustRoot, "src/platform/darwin/index.ts");
	if (await exists(platformPath)) push("window", "ok", platformPath);
	else
		push(
			"window",
			"fail",
			"the macOS platform layer is not implemented yet (src/platform/darwin)",
		);

	// The three known-fatal traps, named only when the project hits one.
	for (const trap of await scanTraps(resolve(options.dir))) {
		push(trap.name, trap.status, trap.detail);
	}

	// Bundle and its Gatekeeper consequence.
	const bundle = await findAppBundle(options.dir);
	if (bundle) {
		push("bundle", "note", bundle);
		const signature = await describeSignature(bundle).catch(() => undefined);
		const adHoc = signature?.includes("adhoc") ?? false;
		push(
			"gatekeeper",
			"note",
			adHoc
				? "ad-hoc signed: refused elsewhere until a Developer ID signature exists"
				: "signature state unknown — `crust sign` needs CRUST_SIGNING_IDENTITY",
		);
	} else {
		push("bundle", "note", "no .app in dist — run crust build first");
	}

	console.log(`crust doctor — ${options.dir}`);
	for (const check of checks) {
		line(check.name, `[${check.status}] ${check.detail}`);
	}

	const failures = checks.filter((check) => check.status === "fail").length;
	if (failures > 0) {
		console.error(`\n${failures} check${failures === 1 ? "" : "s"} failed`);
		return 1;
	}
	console.log("\nall checks passed");
	return 0;
}
