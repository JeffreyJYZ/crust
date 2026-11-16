/**
 * The plugin mechanism itself: `definePlugin` and the types a definition is written against,
 * plus the registry a bridge is built from. Everything else in this directory is a plugin.
 *
 * Re-exports only, so `index.ts` stays a map of the plugin surface rather than the surface itself.
 */

export {
	type ArgsOf,
	type CommandHandler,
	type CommandMap,
	type CommandSchema,
	type MaybePromise,
	type NotImplemented,
	type PluginContext,
	type PluginDefinition,
	type ResultOf,
	type SchemaOf,
	definePlugin,
	isNotImplemented,
	notImplemented,
	NotImplementedError,
} from "./define";
export { handlerMap, type HandlerSource, PluginRegistry } from "./registry";
