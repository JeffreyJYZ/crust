/**
 * Runtime proof for two surfaces that need no window: `theme` against the real `NSAppearance`
 * on this machine, and `i18n` against a real catalogue with a plural form.
 *
 * The theme plugin is built from the darwin adapter directly, the same way the key-press proof
 * builds the shortcuts plugin: the runtime's own instance is private to `startApp`.
 */
import { darwinThemeAdapter } from "../../src/platform/darwin/theme.ts";
import { darwinLocaleAdapter } from "../../src/platform/darwin/locale.ts";
import { createI18nPlugin } from "../../src/plugins/i18n.ts";
import { createThemePlugin } from "../../src/plugins/theme.ts";
import { mark } from "./proofs.ts";

/** A plugin call needs a context; the theme plugin emits, so the sink records instead of dropping. */
function context(): { emit: (event: string, data: unknown) => void; heard: string[] } {
	const heard: string[] = [];
	return { heard, emit: (event, data) => heard.push(`${event}=${JSON.stringify(data)}`) };
}

/**
 * Commands are typed by their own arity — `current` takes none, `set` takes a context — so the
 * probe invokes by name through one loose view instead of repeating a cast per command.
 */
function invoker(commands: unknown): (name: string, ...args: unknown[]) => Promise<unknown> {
	const table = commands as Record<string, (...args: unknown[]) => unknown>;
	return async (name, ...args) => {
		const handler = table[name];
		if (typeof handler !== "function") throw new Error(`crust: command "${name}" is missing`);
		return await handler(...args);
	};
}

export async function proveTheme(): Promise<boolean> {
	const invoke = invoker(createThemePlugin(darwinThemeAdapter()).commands);
	const ctx = context();

	const before = (await invoke("current")) as {
		appearance?: string;
		source?: string;
		ok?: boolean;
	};
	if (before.ok !== true) {
		console.log(`theme     unreadable: ${JSON.stringify(before)}`);
		return mark("theme", false);
	}

	// Round trip through the other appearance and back, so the proof shows a real
	// `setAppearance:` reaching the window server rather than a cached field.
	const target = before.appearance === "dark" ? "light" : "dark";
	await invoke("set", { appearance: target }, ctx);
	const after = (await invoke("current")) as { appearance?: string };
	await invoke("reset", {}, ctx);
	const restored = (await invoke("current")) as { appearance?: string };

	const moved = after.appearance === target;
	const cameBack = restored.appearance === before.appearance;
	const emitted = ctx.heard.length >= 2;
	console.log(
		`theme     ${before.appearance} source=${before.source} set=${after.appearance} reset=${restored.appearance} events=${ctx.heard.length}`,
	);
	if (!moved || !cameBack || !emitted) {
		console.log(`theme     failed: moved=${moved} cameBack=${cameBack} emitted=${emitted}`);
		return mark("theme", false);
	}
	return mark("theme", true);
}

export async function proveI18n(): Promise<boolean> {
	const invoke = invoker(
		createI18nPlugin({
			// The runtime registers this adapter, so the proof reads the system's own language.
			adapter: darwinLocaleAdapter(),
			locale: "en",
			messages: {
				en: {
					greeting: "hello {name}",
					files_one: "one file",
					files_other: "{count} files",
				},
			},
		}).commands,
	);
	const ctx = context();

	const greeting = (await invoke("translate", { key: "greeting", vars: { name: "crust" } })) as {
		text?: string;
	};
	const one = (await invoke("translate", { key: "files", vars: { count: 1 } })) as {
		text?: string;
	};
	const many = (await invoke("translate", { key: "files", vars: { count: 7 } })) as {
		text?: string;
	};
	const locale = (await invoke("locale", {}, ctx)) as { locale?: string };

	console.log(
		`i18n      locale=${locale.locale} greeting=${JSON.stringify(greeting.text)} plural=${JSON.stringify(one.text)}/${JSON.stringify(many.text)}`,
	);
	const ok =
		greeting.text === "hello crust" && one.text === "one file" && many.text === "7 files";
	if (!ok) {
		console.log("i18n      failed: a message did not interpolate or pluralise");
		return mark("i18n", false);
	}
	return mark("i18n", true);
}
