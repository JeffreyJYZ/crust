/**
 * The window-chrome and shortcut proofs: the two surfaces that need a live AppKit object.
 * `createPlatform` is a second instance because the runtime's own is private to `startApp`;
 * every adapter is the real one, so both lines describe what macOS actually holds.
 */
import { createShortcutsPlugin, createWindowPlugin } from "crust/plugin";
import { createPlatform } from "../../src/platform/darwin/platform.ts";
import { darwinShortcutsAdapter } from "../../src/platform/darwin/shortcuts.ts";
import { darwinWindowAdapter } from "../../src/platform/darwin/window-adapter.ts";
import { ACCEL, LABEL, mark } from "./proofs.ts";

/** A second platform, because the runtime's own is private to `startApp`. */
export function proveChrome(): boolean {
	const platform = createPlatform({ appName: "Parity probe" });
	const window = createWindowPlugin(darwinWindowAdapter(platform));
	const created = window.commands.create({
		label: LABEL,
		title: "Parity probe",
		width: 240,
		height: 160,
		url: "about:blank",
	});
	if (created.ok !== true) {
		console.log(`chrome    create refused: ${JSON.stringify(created)}`);
		return mark("chrome", false);
	}
	try {
		const wroteOpacity = window.commands.setOpacity({ label: LABEL, value: 0.75 });
		const opacity = window.commands.opacity({ label: LABEL });
		const wroteDecorations = window.commands.setDecorations({ label: LABEL, value: false });
		const decorations = window.commands.isDecorated({ label: LABEL });
		const alpha = (opacity as { opacity?: number }).opacity;
		const decorated = (decorations as { decorations?: boolean }).decorations;
		console.log(`chrome    opacity ${alpha}, decorations ${decorated}`);
		return mark(
			"chrome",
			wroteOpacity.ok === true &&
				wroteDecorations.ok === true &&
				alpha === 0.75 &&
				decorated === false,
		);
	} finally {
		window.commands.close({ label: LABEL });
	}
}

type Seam = (accelerator: string) => void;

/** The test seam: `dispatch` on the macOS adapter, or a `fire`/`trigger` on either half. */
function seamOf(adapter: object, commands: object): Seam | undefined {
	for (const name of ["dispatch", "trigger", "fire", "simulate"]) {
		const member = (adapter as Record<string, unknown>)[name];
		if (typeof member === "function") {
			return (accelerator) => (member as (one: string) => void).call(adapter, accelerator);
		}
	}
	for (const name of ["fire", "trigger", "simulate"]) {
		const member = (commands as Record<string, unknown>)[name];
		if (typeof member === "function") {
			return (accelerator) => {
				(member as (args: unknown) => void).call(commands, { accelerator });
			};
		}
	}
	return undefined;
}

/** The canonical accelerator is what the seam and the emitted event both carry. */
export function proveShortcut(): boolean {
	const adapter = darwinShortcutsAdapter();
	const plugin = createShortcutsPlugin(adapter);
	const emitted: string[] = [];
	const ctx = {
		emit: (event: string, data: unknown) => {
			if (event !== "shortcut") return;
			const accelerator = (data as { accelerator?: unknown } | null)?.accelerator;
			if (typeof accelerator === "string") emitted.push(accelerator);
		},
	};
	const registered = plugin.commands.register({ accelerator: ACCEL }, ctx);
	try {
		if (registered.ok !== true) {
			console.log(`shortcut  register refused: ${JSON.stringify(registered)}`);
			return mark("shortcut", false);
		}
		const seam = seamOf(adapter, plugin.commands);
		if (seam === undefined) {
			// Registration alone never emitted a shortcut; an unfirable seam is a fail.
			console.log("shortcut  seam unavailable — registered, but nothing can fire it here");
			return mark("shortcut", false);
		}
		seam(registered.accelerator);
		const heard = emitted.at(-1);
		console.log(`shortcut  emitted: ${heard ?? "nothing"}`);
		return mark("shortcut", heard === registered.accelerator);
	} finally {
		plugin.commands.unregisterAll();
	}
}
