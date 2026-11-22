/**
 * Startup honesty for plugins whose native half never arrived. A page's first call is too late:
 * by then a silent menu install or an unset notification center looks like an app that chose not
 * to use them. Registration names the whole set once, in the framework's own log.
 */

import { logEvent } from "../logging/logger";
import { platformRecord } from "../logging/records";
import type { PluginDefinition } from "./define";

/** One report per distinct set of gaps, however many registries a process builds. */
const reported = new Set<string>();

/**
 * The namespaces registered without their native half. A gap is a plugin that declared a
 * `native` requirement and got no adapter; each line names the plugin and the call a page's
 * invoke would blame. Pure so a test can assert the report without starting a logger.
 */
export function nativeGaps(plugins: readonly PluginDefinition[]): string[] {
	return plugins
		.filter((plugin) => plugin?.native?.available === false)
		.map((plugin) => `${plugin.name} needs ${plugin.native?.requires}`);
}

/** Say the whole set once, at registration, before any page call can be mistaken for a cancel. */
export function reportNativeGaps(plugins: readonly PluginDefinition[]): void {
	const gaps = nativeGaps(plugins);
	if (gaps.length === 0) return;
	const signature = gaps.join("; ");
	if (reported.has(signature)) return;
	reported.add(signature);
	logEvent(
		platformRecord({
			api: "app.native",
			code: "not-implemented",
			detail: `${gaps.join("; ")}. No native adapter was registered; every command on these namespaces will refuse.`,
		}),
	);
}
