/**
 * The plugin seam.
 *
 * A plugin is a name plus a command map. The bridge keys handlers as
 * `"<plugin>.<command>"`, and `definePlugin` refuses a name that would make that
 * key ambiguous, so a command can never be reached under the wrong plugin.
 *
 * A command the platform cannot run yet returns a typed `NotImplemented`
 * instead of pretending. That is the rule the brief sets: fail honestly, not
 * silently.
 */

import { CrustError } from "../bridge/errors";

export type MaybePromise<T> = T | Promise<T>;

/** What every handler is given besides its own arguments. */
export interface PluginContext {
	/** Push a server-sent event to every connected page. */
	emit(event: string, data: unknown): void;
}

export type CommandHandler<Args = any, Result = any> = (
	args: Args,
	ctx: PluginContext,
) => MaybePromise<Result>;

export type CommandMap = Record<string, CommandHandler<any, any>>;

export interface PluginDefinition<
	Name extends string = string,
	Commands extends CommandMap = CommandMap,
> {
	readonly name: Name;
	readonly commands: Commands;
}

/** The result a command returns when the platform cannot run it yet. */
export interface NotImplemented {
	readonly ok: false;
	readonly code: "not-implemented";
	readonly message: string;
	/** The selector or framework the command is waiting on. */
	readonly requires: string;
}

export function notImplemented(message: string, requires: string): NotImplemented {
	return { ok: false, code: "not-implemented", message, requires };
}

/** A command that rejects rather than returning a value uses this. */
export class NotImplementedError extends CrustError {
	readonly requires: string;

	constructor(message: string, requires: string) {
		super("not-implemented", message, { requires });
		this.name = "NotImplementedError";
		this.requires = requires;
	}
}

export function isNotImplemented(value: unknown): value is NotImplemented {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as NotImplemented).code === "not-implemented" &&
		(value as NotImplemented).ok === false
	);
}

/**
 * Declare a plugin.
 *
 * The name is doubled as the invoke namespace, so it must be a non-empty token
 * with no dot in it: `"<plugin>.<command>"` is the handler key and a dotted
 * plugin name would collide with another plugin's command.
 */
export function definePlugin<Name extends string, Commands extends CommandMap>(plugin: {
	name: Name;
	commands: Commands;
}): PluginDefinition<Name, Commands> {
	const { name, commands } = plugin;
	if (typeof name !== "string" || name.length === 0) {
		throw new CrustError("bad-request", "definePlugin: name must be a non-empty string");
	}
	if (name.includes(".")) {
		throw new CrustError("bad-request", `definePlugin: name "${name}" may not contain a dot`);
	}
	if (typeof commands !== "object" || commands === null) {
		throw new CrustError(
			"bad-request",
			`definePlugin: plugin "${name}" needs a commands object`,
		);
	}
	const entries = Object.entries(commands);
	if (entries.length === 0) {
		throw new CrustError("bad-request", `definePlugin: plugin "${name}" has no commands`);
	}
	for (const [command, handler] of entries) {
		if (command.includes(".")) {
			throw new CrustError(
				"bad-request",
				`definePlugin: ${name}.${command} may not contain a dot`,
			);
		}
		if (typeof handler !== "function") {
			throw new CrustError(
				"bad-request",
				`definePlugin: ${name}.${command} is not a function`,
			);
		}
	}
	return Object.freeze({ name, commands: Object.freeze({ ...commands }) });
}

/** Arguments of a command handler, for typed clients. */
export type ArgsOf<Handler> = Handler extends (args: infer Args, ctx: any) => any ? Args : never;

/** Resolved result of a command handler, for typed clients. */
export type ResultOf<Handler> = Handler extends (args: any, ctx: any) => infer Result
	? Awaited<Result>
	: never;

/** `{ plugin: { command: handler } }`, the shape the page-side client is typed by. */
export type CommandSchema = Record<string, CommandMap>;

/** Turn a tuple of plugin definitions into the schema a typed client takes. */
export type SchemaOf<Plugins extends readonly PluginDefinition[]> = {
	[Plugin in Plugins[number] as Plugin["name"]]: Plugin["commands"];
};
