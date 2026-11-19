/**
 * `crust:testing` — drive and observe a running window's page from inside that page.
 *
 * Every command runs one JavaScript expression through the platform's
 * `-evaluateJavaScript:completionHandler:` and answers what the page said. Input is therefore
 * ordinary DOM: `click()` and `dispatchEvent` in the window's own webview, never a `CGEvent`, never
 * the human's cursor, and never an Accessibility or Screen Recording grant.
 *
 * The namespace is **gated**: `core.ts` registers it only when `process.env.CRUST_TEST === "1"`, so a
 * normal `crust build` has no `testing` handler at all and a page calling it gets `unknown-plugin`
 * like any unregistered namespace. A test environment signals itself with one variable rather than a
 * config key, because a config key would ship in the app's own `crust.config.ts` and turn the gate
 * into a setting somebody could leave on.
 *
 * The native half is one method, so a platform with no webview answers `not-implemented` naming the
 * call instead of pretending. `setTestingAdapter` is the seam the runtime uses to install the darwin
 * adapter once, after its platform exists; without it every command answers that same refusal.
 * Capabilities need no wiring of their own: a `testing` grant is the same `testing:*` pattern every
 * other namespace uses, and an unregistered namespace is never reachable to grant.
 */

import { definePlugin, type NotImplemented, type PluginDefinition } from "./define";
import { driveCommands } from "./testing-drive";
import { observeCommands } from "./testing-observe";
import { createRunner } from "./testing-run";
import type { TestingAdapter, TestingCommands } from "./testing-types";

export * from "./testing-args";
export * from "./testing-observe";
export type * from "./testing-types";

/** The adapter installed by the runtime once its platform exists, if any. */
let installed: TestingAdapter | undefined;

/** Install the platform's evaluator. `undefined` removes it, which is what a test's teardown wants. */
export function setTestingAdapter(adapter: TestingAdapter | undefined): void {
	installed = adapter;
}

/**
 * Build the namespace. An explicit adapter wins; otherwise the one `setTestingAdapter` installed is
 * used, resolved per call so a window created after registration is still reachable.
 */
export function createTestingPlugin(
	adapter?: TestingAdapter,
): PluginDefinition<"testing", TestingCommands> {
	const native = (): TestingAdapter | undefined => adapter ?? installed;
	const run = createRunner(native);
	return definePlugin({
		name: "testing",
		commands: {
			...driveCommands(run),
			...observeCommands(run),
		},
	}) as PluginDefinition<"testing", TestingCommands>;
}

/** The default registration: no adapter, so every command names the call it is missing. */
export const testingPlugin = createTestingPlugin();
