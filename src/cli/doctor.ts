import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { cc, FFIType } from "bun:ffi";
import { startBridge } from "@/bridge/server.ts";
import { isIgnoredWatchPath } from "@/cli/ignore";
import { findConfig, loadConfig, type CrustConfig } from "@/config";
import { describeSignature } from "@/packaging/sign";
import { buildPage, detectSingle, type SingleApp, type SingleDetection } from "@/single";
import { listAssets, readAsset } from "./assets.ts";
import { inExecutable } from "./framework.ts";
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

/** Every check prints one line, so a multi-line compiler error is joined. */
function inline(text: string): string {
	return text.replaceAll("\n", " | ");
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
	const onDisk = resolve(crustRoot, "src/platform/darwin/shim.c");
	let source = onDisk;
	let label = onDisk;
	let temporary: string | undefined;

	if (!inExecutable() && (await exists(onDisk))) {
		// A checkout: compile the file that is there.
	} else {
		// A compiled executable carries the shim as text, and `cc()` cannot read the
		// embedded tree — TinyCC opens the path itself and the vfs is not a path it
		// can open. Materialise what this process can read and compile that.
		const embedded = await readAsset("src/platform/darwin/shim.c");
		if (!embedded) {
			return {
				name: "shim",
				status: "fail",
				detail: `missing ${onDisk}, and not embedded in this executable`,
			};
		}
		temporary = join(tmpdir(), `crust-doctor-${process.pid}-shim.c`);
		await Bun.write(temporary, embedded);
		source = temporary;
		label = "embedded src/platform/darwin/shim.c";
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
		return { name: "shim", status: "ok", detail: `${label} compiles with cc()` };
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		return {
			name: "shim",
			status: "fail",
			detail: `${label} does not compile — ${inline(text)}`,
		};
	} finally {
		if (temporary) await rm(temporary, { force: true });
	}
}

/**
 * The port `startApp` will prefer for an app id.
 *
 * This is the same FNV-1a derivation `preferredPortFor` uses in `src/runtime.ts`
 * (`45000 + hash % 4000`), and it is duplicated here because doctor must know
 * the *preferred* port to tell "stable" from "the app walked upward". The pair
 * is pinned by a test that starts the real runtime and compares the port it
 * binds, so a change there fails the suite instead of silently making this
 * stale.
 */
export function preferredPort(appId: string): number {
	let hash = 2166136261;
	for (let index = 0; index < appId.length; index++) {
		hash ^= appId.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return 45000 + ((hash >>> 0) % 4000);
}

interface BoundBridge {
	bridge: ReturnType<typeof startBridge>;
	/** The port derived from the app id, absent when there is no id to derive from. */
	preferred?: number;
	/** How many ports above the preferred one were taken before this bind. */
	drift: number;
}

const PORT_ATTEMPTS = 20;
const DOCTOR_HANDLERS = { "__doctor.ping": () => "pong" };

/**
 * Bind the bridge the way the runtime does: the port derived from the app id,
 * walking upward when it is taken, and falling back to the OS's choice last.
 *
 * Doctor used to bind `0` only, which proves the bridge works but not the thing
 * that changed: an app whose derived port is occupied still opens, on a
 * different origin, and loses everything origin-scoped. Binding the same port
 * here is what lets that be reported instead of hidden.
 */
function bindBridge(appId: string | undefined): BoundBridge | undefined {
	const preferred = appId === undefined ? undefined : preferredPort(appId);
	const attempts = preferred === undefined ? 1 : PORT_ATTEMPTS + 1;
	for (let offset = 0; offset < attempts; offset++) {
		const port = preferred === undefined || offset === PORT_ATTEMPTS ? 0 : preferred + offset;
		try {
			return {
				bridge: startBridge({ handlers: DOCTOR_HANDLERS, port }),
				preferred,
				drift: offset,
			};
		} catch (error) {
			// Only a taken port is retried; anything else is doctor's to report.
			const text = error instanceof Error ? error.message : String(error);
			if (!/EADDRINUSE|in use/i.test(text)) throw error;
		}
	}
	return undefined;
}

/**
 * Bind the app's own port and answer one invoke through it.
 *
 * The port is released before doctor returns, so this leaves nothing running.
 */
async function checkBridge(appId: string | undefined): Promise<Check> {
	const bound = bindBridge(appId);
	if (!bound) {
		return {
			name: "bridge",
			status: "fail",
			detail: "could not bind any port — the OS refused every attempt, so the window has no bridge",
		};
	}
	const { bridge, preferred, drift } = bound;
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
		if (preferred === undefined) {
			return {
				name: "bridge",
				status: "ok",
				detail: `${bridge.url} answered "pong" (ephemeral — no app.id was read, so the stable port is not tested)`,
			};
		}
		if (drift === 0) {
			return {
				name: "bridge",
				status: "ok",
				detail: `${bridge.url} answered "pong" (stable port for ${appId})`,
			};
		}
		return {
			name: "bridge",
			status: "note",
			detail:
				`port ${preferred} is busy, so this launch binds ${bridge.port}; the page origin changes ` +
				"and localStorage/IndexedDB from the previous origin do not carry over — close the app " +
				"holding that port",
		};
	} finally {
		await bridge.stop();
	}
}

/** Hostnames whose ports are this machine's to report on. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export type DevUrlTarget = { hostname: string; port: number } | "remote" | "unreadable";

/**
 * The port a `dev.url` names, when that URL is a loopback name doctor can probe.
 *
 * A remote URL's port belongs to that host, so there is nothing local to check,
 * and `new URL` rejects strings a config can still carry. Both are told apart
 * from a real target so each gets its own one-line note rather than a failure.
 */
export function devUrlTarget(url: string): DevUrlTarget {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return "unreadable";
	}
	if (!LOOPBACK_HOSTNAMES.has(target.hostname.toLowerCase())) return "remote";
	const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
	return Number.isInteger(port) && port > 0 ? { hostname: target.hostname, port } : "unreadable";
}

/**
 * Whether a TCP connection to `hostname:port` is accepted.
 *
 * This is the client half of "is that port free": a refused connection answers
 * in a millisecond on loopback, and the timeout only bounds a host that drops.
 */
async function portAccepts(hostname: string, port: number): Promise<boolean> {
	const connect = Bun.connect({
		hostname,
		port,
		socket: {
			data() {},
			open(socket) {
				socket.end();
			},
		},
	}).then(
		() => true,
		() => false,
	);
	return await Promise.race([connect, Bun.sleep(750).then(() => false)]);
}

/** The pid holding a listening TCP port, from `lsof`; absent when unreadable. */
async function portHolder(port: number): Promise<number | undefined> {
	const text = await shellOutput(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
	const first = text?.split("\n")[0]?.trim();
	if (first === undefined || first.length === 0) return undefined;
	const pid = Number.parseInt(first, 10);
	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export interface DevPortFacts {
	url: string;
	port: number;
	/** A TCP connection to the port was accepted. */
	listening: boolean;
	/** An HTTP request to `url` answered, with any status. */
	answered: boolean;
	/** The listening pid, when `lsof` could read it. */
	holder?: number;
}

/**
 * Turn the port probe into one line.
 *
 * A busy port is not a broken project: a dev server the user already has open
 * is exactly what `dev.url` describes. Only a holder that answers nothing on
 * that URL is fatal, because `strictPort` then refuses to start and `crust dev`
 * waits 30 s for a page nothing will serve.
 */
export function classifyDevPort(facts: DevPortFacts): Check {
	const { url, port, listening, answered, holder } = facts;
	const who =
		holder === undefined ? "a process lsof cannot read (another user)" : `pid ${holder}`;
	if (!listening && !answered) {
		return { name: "dev port", status: "ok", detail: `port ${port} is free for ${url}` };
	}
	if (listening && answered) {
		return {
			name: "dev port",
			status: "note",
			detail:
				`port ${port} is held by ${who} and already answers ${url} — an existing dev server is fine; ` +
				"free it or change dev.url to run a second one",
		};
	}
	if (listening) {
		return {
			name: "dev port",
			status: "fail",
			detail:
				`port ${port} is held by ${who}, which does not answer ${url} — a strictPort dev server cannot ` +
				"start there, and crust dev would wait 30 s for a page nothing serves; free the port or change dev.url",
		};
	}
	return {
		name: "dev port",
		status: "note",
		detail: `${url} answers but nothing is listening on port ${port} locally — a proxy or a remote host is serving it`,
	};
}

/** A config, test or declaration file is not page code, whatever its extension. */
const NOT_PAGE_CODE = /\.(?:config|test|spec|d)\.ts$/i;

/**
 * Page-side `.ts` modules the backend watcher will treat as backend code.
 *
 * `crust dev` skips frontend extensions (`.tsx`, `.jsx`, `.css`, …) for a
 * `dev.url` project, but `.ts` is deliberately not among them because the
 * backend entry is one. A page module written as `.ts` therefore restarts the
 * runtime on every save and rotates the bridge token. The entry, config, test,
 * declaration and watched-out paths are excluded; what remains is the trap.
 */
export async function pageSideTypeScript(dir: string, entry?: string): Promise<string[]> {
	const root = resolve(dir);
	const entryPath = entry === undefined ? undefined : resolve(root, entry);
	const found: string[] = [];
	for (const relative of await projectSources(root)) {
		if (extname(relative).toLowerCase() !== ".ts") continue;
		if (NOT_PAGE_CODE.test(relative)) continue;
		if (isIgnoredWatchPath(relative)) continue;
		if (entryPath !== undefined && resolve(root, relative) === entryPath) continue;
		found.push(relative);
	}
	return found.sort();
}

/** The watcher note: a count and the first few names, never a lecture. */
export function watcherNote(files: string[]): Check {
	const shown = files.slice(0, 3).join(", ");
	const rest = files.length > 3 ? `, +${files.length - 3} more` : "";
	const plural = files.length === 1 ? "" : "s";
	return {
		name: "dev watch",
		status: "note",
		detail:
			`${files.length} page-side .ts file${plural} (${shown}${rest}) — the watcher skips .tsx/.jsx/.css ` +
			"but not .ts, so saving one restarts the backend and rotates the bridge token; rename them .tsx, " +
			"or move them under a skipped directory such as public/",
	};
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
 * What `crust build` would embed, decided without compiling anything.
 *
 * A named `build.assets` is a promise of an `index.html`; a missing or stale
 * directory is why a built app opens on a blank page, so it fails here with the
 * path and the command that produces it. When the setting is absent the old
 * `public/` rule stands — except for a project that runs `beforeBuildCommand`
 * and has no `public/index.html`, where crust would silently embed nothing.
 */
export async function checkAssets(dir: string, config: CrustConfig): Promise<Check> {
	const setting = config.build?.assets;
	const command = config.build?.beforeBuildCommand;
	const hint = command ? `\`${command}\`` : "`bun x vite build`";
	const outDir = resolve(dir, "dist");

	if (setting !== undefined) {
		const assetsDir = resolve(dir, setting);
		if (assetsDir === outDir) {
			return {
				name: "assets",
				status: "fail",
				detail:
					`build.assets "${setting}" is ${outDir}, where crust build writes its own output — ` +
					"point it at the frontend's directory (for Vite, dist/web)",
			};
		}
		if (!(await exists(assetsDir, "dir"))) {
			return {
				name: "assets",
				status: "fail",
				detail:
					`build.assets "${setting}" (${assetsDir}) is missing — run the frontend build (${hint}) ` +
					"then crust build; a build now embeds no page",
			};
		}
		if (!(await exists(join(assetsDir, "index.html")))) {
			return {
				name: "assets",
				status: "fail",
				detail:
					`build.assets "${setting}" (${assetsDir}) holds no index.html — the frontend build ` +
					`produced nothing there; run it (${hint}) then crust build`,
			};
		}
		return {
			name: "assets",
			status: "ok",
			detail:
				`"${setting}" at ${assetsDir} has index.html` +
				(command ? ` (beforeBuildCommand ${hint} is not run by doctor)` : ""),
		};
	}

	if (await exists(join(dir, "public", "index.html"))) {
		return { name: "assets", status: "ok", detail: `${resolve(dir, "public")} has index.html` };
	}
	if (command) {
		return {
			name: "assets",
			status: "fail",
			detail:
				`build.beforeBuildCommand ${hint} is set but build.assets is not and public/index.html is ` +
				"missing — crust would embed nothing; set build.assets to the directory it writes (e.g. dist/web)",
		};
	}
	return {
		name: "assets",
		status: "note",
		detail: `no build.assets and no public/index.html — a backend-only app ships with no page`,
	};
}

const TEMPLATES = ["default", "react", "next"] as const;

/**
 * The scaffolds ship inside the package, so a tarball without `templates/`
 * breaks `crust init` for every template. Nothing else reads them until init
 * runs, which is why this is checked here rather than left to that error.
 */
export async function checkTemplates(root = crustRoot): Promise<Check> {
	const missing: string[] = [];
	let embedded = 0;
	for (const name of TEMPLATES) {
		// `root` is honoured for fixtures; only the real package root falls back to
		// what a compiled executable carries.
		let count: number;
		if (root === crustRoot) {
			const assets = await listAssets(`templates/${name}`).catch(() => []);
			count = assets.length;
			if (count > 0 && !(await exists(resolve(root, "templates", name), "dir"))) embedded++;
		} else {
			const entries = await readdir(resolve(root, "templates", name), {
				withFileTypes: true,
			}).catch(() => []);
			count = entries.length;
		}
		if (count === 0) missing.push(name);
	}
	if (missing.length > 0) {
		return {
			name: "templates",
			status: "fail",
			detail:
				`${missing.map((name) => `templates/${name}`).join(", ")} missing from this install ` +
				`(${resolve(root, "templates")}, and not embedded) — reinstall crust; ` +
				"crust init cannot scaffold without them",
		};
	}
	const where =
		embedded > 0
			? `this executable holds ${TEMPLATES.join(", ")} (embedded with --asset)`
			: `${resolve(root, "templates")} holds ${TEMPLATES.join(", ")}`;
	return { name: "templates", status: "ok", detail: where };
}

const PAGE_EXTENSIONS = new Set([".tsx", ".jsx"]);

function isPageFile(value: string | undefined): boolean {
	return value !== undefined && PAGE_EXTENSIONS.has(extname(value).toLowerCase());
}

/** The one top-level `.tsx`/`.jsx` a configless directory holds, if exactly one. */
async function solePageFile(dir: string): Promise<string | undefined> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const pages = entries
		.filter((entry) => entry.isFile() && PAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
		.map((entry) => entry.name);
	return pages.length === 1 ? pages[0] : undefined;
}

/**
 * Decide whether a configless directory is a single-file app.
 *
 * `crust dev app.tsx` takes no config at all, so failing "config" there would be
 * a false alarm. Only a directory with no backend entry and no config is
 * considered, and only one unambiguous page file — an explicit file or
 * `--entry app.tsx` names it when the directory holds more than one.
 */
async function detectConfiglessSingle(options: CliOptions): Promise<SingleDetection | undefined> {
	const backend = await resolveBackendEntry(options.dir, options.entry);
	const hinted = options.single ?? (isPageFile(options.entry) ? options.entry : undefined);
	if (hinted === undefined && backend !== undefined) return undefined;
	const file = hinted ?? (await solePageFile(options.dir));
	if (file === undefined) return undefined;
	return await detectSingle({ single: file, dir: options.dir });
}

/**
 * `crust doctor` — report the state of everything the app needs, in the order
 * a failure actually happens: platform, runtime, config (or the single file),
 * shim, bridge on the app's own port, the dev server's port and URL, entry, the
 * watcher's `.ts` trap, window layer, the known-fatal traps, what a build would
 * embed, the scaffolding, bundle.
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

	// Config, or the single file that needs none. A config that exists but is
	// broken is always a failure; only a config that is *absent* and a directory
	// with no backend entry is considered a single-file app.
	let config: CrustConfig | undefined;
	let single: SingleApp | undefined;
	let singleProblem: string | undefined;
	try {
		const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
		config = loaded.config;
		push("config", "ok", loaded.path);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		const absent =
			options.config === undefined && (await findConfig(options.dir)) === undefined;
		if (absent) {
			const detected = await detectConfiglessSingle(options);
			if (detected?.kind === "app") {
				single = detected.app;
				push(
					"config",
					"note",
					`none — a single file needs no config: crust dev ${relative(resolve(options.dir), detected.app.file)}`,
				);
			} else if (detected?.kind === "error") {
				singleProblem = detected.message;
			}
		}
		if (!single) {
			push(
				"config",
				"fail",
				`${inline(text)}${singleProblem ? ` (${singleProblem})` : ""} — fix the key named above, run \`crust init\` for a new project, ` +
					"or use single-file mode (`crust dev <file.tsx>`, which needs no config)",
			);
		}
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

	// The loopback bridge, on the port the app itself will use.
	const bridge = await checkBridge(config?.app.id ?? single?.config.app.id);
	push(bridge.name, bridge.status, bridge.detail);

	// Dev server port and reachability, only when the config names one. The port
	// is checked first because it is the failure a `strictPort` server reports
	// from its own command, after crust has already handed it the terminal.
	if (config?.dev?.url) {
		const url = config.dev.url;
		const target = devUrlTarget(url);
		const listening =
			target === "remote" || target === "unreadable"
				? false
				: await portAccepts(target.hostname, target.port);
		const holder =
			target !== "remote" && target !== "unreadable" && listening
				? await portHolder(target.port)
				: undefined;
		const response = await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null);
		if (target === "unreadable") {
			push("dev port", "note", `dev.url ${url} is not a URL, so it names no port to check`);
		} else if (target === "remote") {
			push(
				"dev port",
				"note",
				`${url} is not loopback, so its port belongs to that host — nothing local to check`,
			);
		} else {
			const port = classifyDevPort({
				url,
				port: target.port,
				listening,
				answered: response !== null,
				holder,
			});
			push(port.name, port.status, port.detail);
		}
		if (response) push("dev url", "ok", `${url} answered ${response.status}`);
		else push("dev url", "fail", `${url} did not answer — is the frontend dev server running?`);
	}

	// Backend entry: `src/main.ts` or `main.ts`, the same rule the CLI uses. A
	// single file is its own entry, since that mode has no backend module.
	const backendEntry = single ? undefined : await resolveBackendEntry(options.dir, options.entry);
	if (single) {
		push(
			"backend",
			"ok",
			`${relative(resolve(options.dir), single.file)} (the page is the entry — no backend module)`,
		);
	} else if (backendEntry) {
		push("backend", "ok", backendEntry.path);
	} else {
		push(
			"backend",
			"fail",
			resolve(options.dir, options.entry ?? "src/main.ts") +
				" does not exist — expected src/main.ts or main.ts",
		);
	}

	// A dev-server project whose page code is `.ts`: the watcher does not skip
	// that extension, so every save restarts the runtime and rotates the bridge
	// token. A note, because the app runs — it just loses the loaded page.
	if (config?.dev?.url) {
		const pageSide = await pageSideTypeScript(options.dir, backendEntry?.path);
		if (pageSide.length > 0) {
			const note = watcherNote(pageSide);
			push(note.name, note.status, note.detail);
		}
	}

	// The page bundle a single file produces, built the way `crust dev` builds it:
	// this mode takes no config, so bundling is the only thing that can fail.
	if (single) {
		try {
			const page = await buildPage(single, { dev: true });
			push(
				"single",
				"ok",
				`${relative(resolve(options.dir), single.file)} bundles to ${relative(resolve(options.dir), join(page.dir, "index.html"))} (the same build crust dev runs)`,
			);
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			push(
				"single",
				"fail",
				`${relative(resolve(options.dir), single.file)} does not bundle — ${inline(text)}; ` +
					"crust dev would stop here with the same error",
			);
		}
	}

	// Window layer. Importing it is the check: a compiled executable carries the
	// module and has no file on disk to stat, so a path check would report a failure
	// for a build that works.
	try {
		const platform = await import("@/platform/darwin");
		push(
			"window",
			"ok",
			`platform module loaded, ${platform.PREFLIGHT.length} preflight entries`,
		);
	} catch (error) {
		const text = error instanceof Error ? error.message : String(error);
		push("window", "fail", `the macOS platform layer did not load — ${inline(text)}`);
	}

	// The three known-fatal traps, named only when the project hits one.
	for (const trap of await scanTraps(resolve(options.dir))) {
		push(trap.name, trap.status, trap.detail);
	}

	// What a build would embed: the failure behind a built app's blank window.
	if (config) {
		const assets = await checkAssets(options.dir, config);
		push(assets.name, assets.status, assets.detail);
	} else if (single) {
		push(
			"assets",
			"note",
			"not checked: single-file mode embeds the page it bundles, so there is no build.assets to read",
		);
	} else {
		push("assets", "note", "not checked: no valid config to read build.assets from");
	}

	// The scaffolds ship in the package; a tarball without them breaks init.
	const templates = await checkTemplates();
	push(templates.name, templates.status, templates.detail);

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
