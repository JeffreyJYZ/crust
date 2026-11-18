/**
 * The live command surface, enumerated with no platform and no window.
 *
 * `nativePlugins(corePlugins, undefined, { app: "x" })` is measured to register the full set (32
 * on this tree): passing `undefined` for the platform takes the non-Darwin branch, which still
 * registers every namespace under its own name with honest `not-implemented` answers. The table
 * is therefore read from the registry, never guessed from prose.
 */
import { corePlugins } from "@/plugins/core.ts";
import { nativePlugins } from "@/runtime-plugins.ts";

export interface Namespace {
	name: string;
	commands: string[];
}

/**
 * Commands keep their declared order — `Object.keys` preserves insertion order for string keys.
 * Only namespaces are sorted, so a registry edit cannot reshuffle the rendered rows.
 */
export async function registry(): Promise<Namespace[]> {
	const plugins = await nativePlugins(corePlugins, undefined, { app: "x" });
	return plugins
		.map((plugin) => ({ name: plugin.name, commands: Object.keys(plugin.commands) }))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
