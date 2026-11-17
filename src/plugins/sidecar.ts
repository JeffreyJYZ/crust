/**
 * `crust:sidecar` — spawn a binary that shipped inside the bundle beside the app's executable.
 * Names come from `build.sidecars`; a page cannot name a program that was not declared, and a
 * declared name whose file is missing is a typed failure rather than a bare `ENOENT` from spawn.
 * stdout and stderr stream as `sidecar-stdout` / `sidecar-exit` events, and the exit fires even
 * when the process ends mid-stream — the same three cases Butter's sidecar plugin handles.
 */

import { existsSync } from "node:fs";

import { definePlugin, type PluginDefinition } from "./define";
import { declaredSidecars, defaultSidecarDir, resolveSidecar } from "./sidecar-locate";
import type {
	SidecarChild,
	SidecarCommands,
	SidecarExit,
	SidecarOptions,
	SidecarSpawner,
	SidecarStdout,
} from "./sidecar-types";

export * from "./sidecar-locate";
export * from "./sidecar-types";

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const bunSpawn: SidecarSpawner = (cmd, options) =>
	Bun.spawn([...cmd], {
		cwd: options.cwd,
		env: options.env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

/** Decode a stream to text chunks; an exit does not cancel a reader that is still draining. */
async function streamText(
	stream: ReadableStream<Uint8Array> | null,
	onText: (text: string) => void,
): Promise<void> {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value && value.byteLength > 0) onText(decoder.decode(value, { stream: true }));
	}
	const tail = decoder.decode();
	if (tail.length > 0) onText(tail);
}

/**
 * Build the plugin. The declared set is frozen at construction so a page cannot widen it, and a
 * missing file is reported before any process exists.
 */
export function createSidecarPlugin(
	options: SidecarOptions = {},
): PluginDefinition<"sidecar", SidecarCommands> {
	const dir = options.dir ?? defaultSidecarDir();
	// Explicit names win (tests and hosts that read config themselves); otherwise the build
	// manifest beside the binary is the declaration, so a spawned name must have been shipped.
	const names = new Set(options.names ?? declaredSidecars(dir));
	const spawnChild = options.spawn ?? bunSpawn;
	const running = new Set<string>();
	let next = 0;

	return definePlugin({
		name: "sidecar",
		commands: {
			spawn: async (args, ctx) => {
				if (typeof args !== "object" || args === null || typeof args.name !== "string") {
					return {
						ok: false,
						code: "invalid-args",
						message: "sidecar.spawn needs { name }",
					};
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
					child = spawnChild([target, ...argv], {
						env: process.env as Record<string, string>,
					});
				} catch (error) {
					return {
						ok: false,
						code: "sidecar-missing",
						message: `sidecar.spawn: ${JSON.stringify(name)} could not start: ${text(error)}`,
					};
				}
				const id = `sidecar-${++next}`;
				running.add(id);
				const stdout = (data: string) =>
					ctx.emit("sidecar-stdout", { id, name, text: data } satisfies SidecarStdout);
				void streamText(child.stdout, stdout).catch(() => undefined);
				void streamText(child.stderr, stdout).catch(() => undefined);
				void child.exited
					.then((code) => {
						running.delete(id);
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
					.catch(() => {
						running.delete(id);
					});
				return { ok: true, id, name, pid: child.pid };
			},
		},
	});
}

/** The plugin a page reaches as `window.crust.invoke("sidecar", "spawn", …)`. */
export const sidecarPlugin = createSidecarPlugin();
