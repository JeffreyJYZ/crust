/**
 * Plugin registry and handler resolution.
 *
 * The registry is the single place a plugin name becomes a handler lookup. Two
 * registrations of the same name are refused rather than silently overwritten,
 * and an unknown plugin and an unknown command produce different codes so page
 * code can tell a stale plugin from a stale command.
 */

import { CrustError } from "../bridge/errors";
import {
	type CommandHandler,
	type CommandMap,
	type PluginContext,
	type PluginDefinition,
	isNotImplemented,
} from "./define";

/** Anything the bridge can turn into `"<plugin>.<command>"` handlers. */
export type HandlerSource =
	PluginRegistry | readonly PluginDefinition[] | Record<string, CommandHandler | CommandMap>;

export class PluginRegistry {
	private readonly plugins = new Map<string, PluginDefinition>();

	/** Register plugins. Throws on a duplicate name instead of replacing one. */
	register(...plugins: PluginDefinition[]): this {
		for (const plugin of plugins) {
			if (!plugin || typeof plugin.name !== "string" || typeof plugin.commands !== "object") {
				throw new CrustError("bad-request", "register: not a plugin definition");
			}
			if (this.plugins.has(plugin.name)) {
				throw new CrustError(
					"bad-request",
					`plugin "${plugin.name}" is already registered`,
				);
			}
			this.plugins.set(plugin.name, plugin);
		}
		return this;
	}

	get size(): number {
		return this.plugins.size;
	}

	has(name: string): boolean {
		return this.plugins.has(name);
	}

	get(name: string): PluginDefinition | undefined {
		return this.plugins.get(name);
	}

	names(): string[] {
		return [...this.plugins.keys()];
	}

	commandsOf(name: string): string[] {
		const plugin = this.plugins.get(name);
		if (!plugin) throw new CrustError("unknown-plugin", `no plugin named "${name}"`);
		return Object.keys(plugin.commands);
	}

	/**
	 * Run one command. Every lookup failure is a `CrustError`, and a handler's
	 * own throw is passed through unchanged so its message reaches the page.
	 */
	async invoke(
		pluginName: string,
		commandName: string,
		args: unknown,
		ctx: PluginContext,
	): Promise<unknown> {
		const plugin = this.plugins.get(pluginName);
		if (!plugin) {
			throw new CrustError("unknown-plugin", `no plugin named "${pluginName}"`);
		}
		const handler = plugin.commands[commandName];
		if (typeof handler !== "function") {
			throw new CrustError(
				"unknown-command",
				`${pluginName}.${commandName} is not a command`,
			);
		}
		const result = await handler(args, ctx);
		if (isNotImplemented(result)) {
			throw new CrustError("not-implemented", result.message, { requires: result.requires });
		}
		return result;
	}

	/** Flat `"<plugin>.<command>"` → handler table. */
	handlers(): Map<string, CommandHandler> {
		const table = new Map<string, CommandHandler>();
		for (const plugin of this.plugins.values()) {
			for (const [command, handler] of Object.entries(plugin.commands)) {
				table.set(`${plugin.name}.${command}`, handler);
			}
		}
		return table;
	}
}

function addHandler(
	table: Map<string, CommandHandler>,
	key: string,
	handler: CommandHandler,
): void {
	if (table.has(key)) throw new CrustError("bad-request", `duplicate handler "${key}"`);
	table.set(key, handler);
}

/**
 * Resolve a `HandlerSource` to a flat table.
 *
 * A registry is used as-is; a plugin list is expanded the same way; a record may
 * either carry `"plugin.command"` keys pointing at functions, or plugin names
 * pointing at command maps. The `"plugin.command"` form is the escape hatch for
 * internal commands that are not worth a plugin object.
 */
export function handlerMap(source: HandlerSource): Map<string, CommandHandler> {
	const table = new Map<string, CommandHandler>();

	if (source instanceof PluginRegistry) {
		for (const [key, handler] of source.handlers()) addHandler(table, key, handler);
		return table;
	}

	if (Array.isArray(source)) {
		for (const plugin of source as readonly PluginDefinition[]) {
			if (!plugin || typeof plugin.name !== "string" || typeof plugin.commands !== "object") {
				throw new CrustError(
					"bad-request",
					"handlers: an entry is not a plugin definition",
				);
			}
			for (const [command, handler] of Object.entries(plugin.commands)) {
				if (typeof handler !== "function") {
					throw new CrustError(
						"bad-request",
						`handlers: ${plugin.name}.${command} is not a function`,
					);
				}
				addHandler(table, `${plugin.name}.${command}`, handler);
			}
		}
		return table;
	}

	for (const [key, value] of Object.entries(
		source as Record<string, CommandHandler | CommandMap>,
	)) {
		if (typeof value === "function") {
			if (!key.includes(".")) {
				throw new CrustError(
					"bad-request",
					`handlers: "${key}" needs a "plugin.command" form`,
				);
			}
			addHandler(table, key, value);
			continue;
		}
		if (typeof value !== "object" || value === null) {
			throw new CrustError(
				"bad-request",
				`handlers: "${key}" is neither a handler nor a command map`,
			);
		}
		for (const [command, handler] of Object.entries(value)) {
			if (typeof handler !== "function") {
				throw new CrustError(
					"bad-request",
					`handlers: ${key}.${command} is not a function`,
				);
			}
			addHandler(table, `${key}.${command}`, handler);
		}
	}
	return table;
}
