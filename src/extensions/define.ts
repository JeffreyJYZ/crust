/**
 * The extension seam: an extension is a plugin a project ships as its own `.ts` file, discovered
 * from disk and embedded by `crust build`, so it needs no `main.ts` registration. The definition is
 * `definePlugin`'s — same validation, same `"<name>.<command>"` handler keys — plus a brand, so a
 * plain plugin can never be mistaken for one and the loader can refuse it by name.
 */

import { RESERVED_PLUGIN_NAMES } from "@/app-loop.ts";
import { CrustError } from "../bridge/errors.ts";
import { type CommandMap, type PluginDefinition, definePlugin } from "../plugins/define.ts";

/** Names an extension may not claim: everything `startApp` registers before a project's own. */
export const RESERVED_EXTENSION_NAMES: ReadonlySet<string> = RESERVED_PLUGIN_NAMES;

const BRAND: unique symbol = Symbol.for("crust.extension");

export type Extension<
	Name extends string = string,
	Commands extends CommandMap = CommandMap,
> = PluginDefinition<Name, Commands> & { readonly [BRAND]: true };

/** `{ extension: { command: handler } }`, the shape a typed client is generated from. */
export type ExtensionSchema = Record<string, CommandMap>;

/**
 * Declare an extension. `definePlugin` owns every shape rule, so the only extra refusal is the
 * name: an extension that claims `fs` or `app` would overlap the handler table, not override it.
 */
export function defineExtension<Name extends string, Commands extends CommandMap>(extension: {
	name: Name;
	commands: Commands;
}): Extension<Name, Commands> {
	const plugin = definePlugin(extension);
	const { name } = plugin;
	if (RESERVED_EXTENSION_NAMES.has(name)) {
		throw new CrustError(
			"bad-request",
			`defineExtension: extension "${name}" collides with the core plugin "${name}" — a name is a namespace, so pick another`,
		);
	}
	const branded: Extension<Name, Commands> = Object.freeze({
		...plugin,
		[BRAND]: true as const,
	});
	return branded;
}

/** Whether a value came from `defineExtension`, as opposed to `definePlugin` or plain JSON. */
export function isExtension(value: unknown): value is Extension {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { [BRAND]?: unknown })[BRAND] === true
	);
}
