/**
 * The `write`/`list`/`kill` half of `crust:sidecar`. They share the live-child map with `spawn`
 * (built in `sidecar-control.ts`), so every id resolves against one registry and is never a no-op.
 */

import { encoder } from "./sidecar-process";
import type {
	SidecarChild,
	SidecarCommands,
	SidecarFailure,
	SidecarListEntry,
} from "./sidecar-types";

const text = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** `exitCode` or a signal means the OS has already reaped the child, as in `shell.kill`. */
const departed = (child: SidecarChild): boolean =>
	child.exitCode !== null || child.signalCode !== null;

const unknownId = (id: string): SidecarFailure => ({
	ok: false,
	code: "sidecar-unknown-id",
	message: `sidecar: unknown child id ${JSON.stringify(id)}`,
});

export interface LiveSidecar {
	id: string;
	name: string;
	pid: number;
	startedAt: number;
	child: SidecarChild;
	killTimer?: ReturnType<typeof setTimeout>;
}

export function makeControlCommands(deps: {
	running: Map<string, LiveSidecar>;
	names: Set<string>;
	grace: number;
}): Pick<SidecarCommands, "write" | "list" | "kill"> {
	const { running, names, grace } = deps;

	const write: SidecarCommands["write"] = async (args) => {
		if (typeof args !== "object" || args === null || typeof args.id !== "string") {
			return { ok: false, code: "invalid-args", message: "sidecar.write needs { id, data }" };
		}
		const live = running.get(args.id);
		if (live === undefined) return unknownId(args.id);
		const raw: unknown = args.data ?? args.text;
		const bytes =
			typeof raw === "string"
				? encoder.encode(raw)
				: raw instanceof Uint8Array
					? raw
					: undefined;
		if (bytes === undefined) {
			return {
				ok: false,
				code: "invalid-args",
				message: 'sidecar.write: "data" must be a string or Uint8Array',
			};
		}
		if (live.child.stdin === null) {
			return {
				ok: false,
				code: "sidecar-write-failed",
				message: `sidecar.write: child ${JSON.stringify(args.id)} has no stdin pipe`,
			};
		}
		try {
			const writer = live.child.stdin.getWriter();
			try {
				await writer.write(bytes);
			} finally {
				writer.releaseLock();
			}
		} catch (error) {
			return {
				ok: false,
				code: "sidecar-write-failed",
				message: `sidecar.write: ${text(error)}`,
			};
		}
		return { ok: true, id: args.id, bytes: bytes.byteLength };
	};

	const list: SidecarCommands["list"] = async () => {
		const children: SidecarListEntry[] = [...running.values()].map(
			({ id, name, pid, startedAt }) => ({ id, name, pid, startedAt }),
		);
		return { ok: true, children, names: [...names] };
	};

	const kill: SidecarCommands["kill"] = async (args) => {
		if (typeof args !== "object" || args === null || typeof args.id !== "string") {
			return { ok: false, code: "invalid-args", message: "sidecar.kill needs { id }" };
		}
		const live = running.get(args.id);
		if (live === undefined) return unknownId(args.id);
		if (departed(live.child)) {
			// The exit event may not have pruned the record yet; this call kills nothing.
			if (live.killTimer !== undefined) clearTimeout(live.killTimer);
			running.delete(args.id);
			return { ok: true, id: args.id, killed: false };
		}
		try {
			live.child.kill(args.signal ?? "SIGTERM");
		} catch (error) {
			return {
				ok: false,
				code: "sidecar-kill-failed",
				message: `sidecar.kill: ${text(error)}`,
			};
		}
		// A child that ignores SIGTERM gets SIGKILL after the grace. The exit handler clears the
		// timer, so the exit event fires exactly once and no timer outlives the child. A child that
		// left in the meantime is pruned rather than signalled a second time.
		live.killTimer = setTimeout(() => {
			if (!running.has(live.id)) return;
			if (departed(live.child)) {
				running.delete(live.id);
				return;
			}
			try {
				live.child.kill("SIGKILL");
			} catch {
				running.delete(live.id);
			}
		}, grace);
		return { ok: true, id: args.id, killed: true };
	};

	return { write, list, kill };
}
