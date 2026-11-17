/**
 * `crust:sidecar` — spawn a declared binary and own the one live-child registry. `spawn` inserts;
 * `sidecar-commands.ts` reads the same map for `write`/`list`/`kill`, so an id is never a no-op.
 */

import { existsSync } from "node:fs";

import { makeControlCommands, type LiveSidecar } from "./sidecar-commands";
import { resolveSidecar } from "./sidecar-locate";
import { bunSpawn, KILL_GRACE_MS, streamText } from "./sidecar-process";
import type {
	SidecarChild,
	SidecarCommands,
	SidecarExit,
	SidecarOptions,
	SidecarStdout,
} from "./sidecar-types";

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function makeSidecarCommands(config: {
	dir: string;
	names: Set<string>;
	options: SidecarOptions;
}): SidecarCommands {
	const { dir, names, options } = config;
	const spawnChild = options.spawn ?? bunSpawn;
	const grace = options.killGraceMs ?? KILL_GRACE_MS;
	const running = new Map<string, LiveSidecar>();
	let next = 0;

	const spawn: SidecarCommands["spawn"] = async (args, ctx) => {
		if (typeof args !== "object" || args === null || typeof args.name !== "string") {
			return { ok: false, code: "invalid-args", message: "sidecar.spawn needs { name }" };
		}
		const name = args.name;
		if (!names.has(name)) {
			return {
				ok: false,
				code: "sidecar-not-declared",
				message: `sidecar.spawn: ${JSON.stringify(name)} is not in build.sidecars (declared: ${[...names].join(", ") || "none"})`,
			};
		}
		const target = resolveSidecar(dir, name);
		if (target === undefined) {
			return {
				ok: false,
				code: "sidecar-path-escape",
				message: `sidecar.spawn: ${JSON.stringify(name)} escapes the bundle directory ${dir}`,
			};
		}
		if (!existsSync(target)) {
			return {
				ok: false,
				code: "sidecar-missing",
				message: `sidecar.spawn: ${JSON.stringify(name)} was declared but its binary is missing at ${target}`,
			};
		}
		const argv = args.args ?? [];
		if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string")) {
			return {
				ok: false,
				code: "invalid-args",
				message: 'sidecar.spawn: "args" must be an array of strings',
			};
		}
		let child: SidecarChild;
		try {
			child = spawnChild([target, ...argv], { env: process.env as Record<string, string> });
		} catch (error) {
			return {
				ok: false,
				code: "sidecar-missing",
				message: `sidecar.spawn: ${JSON.stringify(name)} could not start: ${text(error)}`,
			};
		}
		const id = `sidecar-${++next}`;
		const live: LiveSidecar = { id, name, pid: child.pid, startedAt: Date.now(), child };
		running.set(id, live);
		const stdout = (data: string) =>
			ctx.emit("sidecar-stdout", { id, name, text: data } satisfies SidecarStdout);
		void streamText(child.stdout, stdout).catch(() => undefined);
		void streamText(child.stderr, stdout).catch(() => undefined);
		const finish = () => {
			if (live.killTimer !== undefined) clearTimeout(live.killTimer);
			running.delete(id);
		};
		void child.exited
			.then((code) => {
				finish();
				const signal = child.signalCode;
				ctx.emit("sidecar-exit", {
					id,
					name,
					// A signal-killed process has no exit code, even if the runtime's
					// exited promise settled with a placeholder number.
					code: signal === null ? code : null,
					signal,
				} satisfies SidecarExit);
			})
			.catch(finish);
		return { ok: true, id, name, pid: child.pid };
	};

	return { spawn, ...makeControlCommands({ running, names, grace }) };
}
