/**
 * Plugin entry point. The surface is split by area so it can keep growing: `barrel-core.ts` is the
 * mechanism, `barrel-platform.ts` the plugins with a native half, `barrel-data.ts` the ones that
 * touch disk, and `barrel-system.ts` the app-level services. Each is re-exports only; this file
 * adds the two values that describe the set as a whole.
 *
 * `corePlugins` is the adapter-free set in the order the design page (`site/app/docs/design/page.mdx`)
 * lists them, each a plain `definePlugin` value — so the same mechanism carries one that works today
 * (`fs`) and three that fail honestly until AppKit or `UNUserNotificationCenter` is reachable.
 */

export * from "./barrel-core";
export * from "./barrel-platform";
export * from "./barrel-data";
export * from "./barrel-system";

/** The adapter-free plugin set and its registry; the doc comment lives with it. */
export { corePlugins, coreRegistry } from "./core";
