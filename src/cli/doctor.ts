import { resolve } from "node:path";
import { type CrustConfig, loadConfig } from "@/config";
import { describeSignature } from "@/packaging/sign";
import { crustRoot, exists, findAppBundle, line, type CliOptions } from "./util.ts";

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
 * `crust doctor` — report the state of everything the app needs, in the order
 * a failure actually happens: platform, runtime, config, dev server, entry,
 * window layer, bundle.
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

	// Dev server reachability, only when the config names one.
	if (config?.dev?.url) {
		const url = config.dev.url;
		const response = await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null);
		if (response) push("dev url", "ok", `${url} answered ${response.status}`);
		else push("dev url", "fail", `${url} did not answer — is the frontend dev server running?`);
	}

	// Backend entry.
	const entry = resolve(options.dir, options.entry ?? "src/main.ts");
	if (await exists(entry)) push("backend", "ok", entry);
	else push("backend", "fail", `${entry} does not exist — expected src/main.ts`);

	// Window layer.
	const platformPath = resolve(crustRoot, "src/platform/darwin/index.ts");
	if (await exists(platformPath)) push("window", "ok", platformPath);
	else
		push(
			"window",
			"fail",
			"the macOS platform layer is not implemented yet (src/platform/darwin)",
		);

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
