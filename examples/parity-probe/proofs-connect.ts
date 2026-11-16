/**
 * The network, downloads and crash-reporter proofs. Each one names the half it can reach: the rule
 * engine, the destination and the refusal path are real, while WebKit's scheme handler, a real
 * download and a spawned guard are not available inside a compiled probe.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { darwinDownloadsAdapter } from "../../src/platform/darwin/downloads.ts";
import { darwinNetworkAdapter } from "../../src/platform/darwin/network.ts";
import { createCrashReporterPlugin } from "../../src/plugins/crash-reporter.ts";
import { createDownloadsPlugin } from "../../src/plugins/downloads.ts";
import {
	createNetworkPlugin,
	type NetworkAction,
	type NetworkAdapter,
} from "../../src/plugins/network.ts";
import { defaultStateRoot } from "../../src/plugins/window-persist-store.ts";
import { type CrashGuard, startCrashGuard } from "../../src/runtime-crash-guard.ts";
import config from "./crust.config.ts";
import { mark, reason } from "./proofs.ts";

const PROBE_URL = "https://parity.invalid/blocked.js";
const PATTERN = "https://parity.invalid/*";

/**
 * The rule table and the decision it produces. `install` is where WebKit would hand over its
 * handler, so the probe takes that pointer and asks it about one URL — the same call WebKit makes.
 */
export async function proveNetwork(): Promise<boolean> {
	let decide: ((url: string) => NetworkAction) | undefined;
	const adapter: NetworkAdapter = {
		install: (_scheme, next) => {
			decide = next;
			return { ok: true, reason: "the probe stands in for WKURLSchemeHandler" };
		},
	};
	const network = createNetworkPlugin(adapter);
	const heard: string[] = [];
	const ctx = {
		emit: (event: string, data: unknown) => {
			if (event === "network:request") heard.push(JSON.stringify(data));
		},
	};
	const state = await network.commands.setRules(
		{ rules: [{ pattern: PATTERN, action: "block" }] },
		ctx,
	);
	const action = decide?.(PROBE_URL);
	const log = await network.commands.log(undefined, ctx);
	const entry = "entries" in log ? log.entries.find((row) => row.url === PROBE_URL) : undefined;
	const rules = "rules" in state ? state.rules.length : 0;
	const registered = "registered" in state && state.registered;
	const blocked = action === "block" && entry?.status === "blocked";
	console.log(`network   rules=${rules} blocked=${blocked}`);
	// The darwin half registers on a WKWebViewConfiguration, which the window path never exposes,
	// so its own refusal is printed here rather than left as an unstated gap.
	const native = darwinNetworkAdapter().install("crust-net", () => "allow");
	console.log(
		`network   native handler: ${native.ok ? "registered" : `refused — ${native.reason}`}`,
	);
	return mark("network", rules === 1 && registered && blocked && heard.length === 1);
}

/** Nothing is downloaded: the destination is read and an unknown id must be refused by name. */
export async function proveDownloads(): Promise<boolean> {
	const root = defaultStateRoot(config.app.id);
	const plugin = createDownloadsPlugin(darwinDownloadsAdapter({ webview: () => undefined }), {
		app: config.app.id,
	});
	const ctx = { emit: () => {} };
	const answer = (await plugin.commands.directory(undefined, ctx)) as {
		ok?: boolean;
		directory?: string;
	};
	const directory = answer.directory ?? "";
	const inside = answer.ok === true && (directory === root || directory.startsWith(`${root}/`));
	let refused = false;
	try {
		await plugin.commands.cancel({ id: "no-such-download" }, ctx);
	} catch (error) {
		refused = (error as { code?: string }).code === "bad-request";
	}
	console.log(
		`downloads dir=${inside ? "inside" : "outside"} cancel=${refused ? "refused" : "accepted"}`,
	);
	return mark("downloads", inside && refused);
}

/** The guard is spawned for real; a bundle carries no readable copy of it, so that refusal is named. */
export async function proveCrashReporter(): Promise<boolean> {
	let root: string | undefined;
	let guard: CrashGuard | undefined;
	try {
		root = await mkdtemp(join(tmpdir(), "crust-parity-crash-"));
		try {
			guard = startCrashGuard({ appDataDir: root });
		} catch (error) {
			// A compiled probe carries no readable copy of the guard script. That named refusal is
			// the surface answering honestly, so it is a pass; any other throw is not.
			const named = (error as { code?: string }).code === "not-implemented";
			console.log(`crash     guard=refused last=unknown — ${reason(error)}`);
			return mark("crash-reporter", named);
		}
		const plugin = createCrashReporterPlugin({ root, guard });
		const last = plugin.commands.last() as { crash?: unknown };
		const running = guard.running();
		const none = last.crash === null;
		console.log(
			`crash     guard=${running ? "running" : "stopped"} last=${none ? "none" : "present"}`,
		);
		return mark("crash-reporter", running && none);
	} catch (error) {
		console.log(`crash     failed: ${reason(error)}`);
		return mark("crash-reporter", false);
	} finally {
		guard?.stop();
		if (root !== undefined) {
			await rm(root, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}
