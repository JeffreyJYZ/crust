/**
 * The drive half of `crust:testing`: `click`, `clickAt`, `type`, `key` and `hover`. Each one
 * dispatches ordinary DOM events in the window's own page, so nothing here posts an event outside
 * the webview and the human's cursor never moves.
 */

import { CrustError } from "../bridge/errors";
import type { TestingModifiers } from "./testing-types";
import type { Runner } from "./testing-run";
import { requireSelector, requireText } from "./testing-args";
import type {
	ClickedResult,
	HoveredResult,
	KeyResult,
	TestingKeyArgs,
	TestingPointArgs,
	TestingSelectorArgs,
	TestingTypeArgs,
	TypedResult,
} from "./testing-types";

export function driveCommands(run: Runner) {
	return {
		/** Scroll the element into view, focus it, then click it as a user's pointer would. */
		click: async (args: TestingSelectorArgs) =>
			run<ClickedResult>("click", {
				selector: requireSelector(args),
				label: args?.label,
			}),
		/** Click whatever is painted at a point: the page's own `elementFromPoint`. */
		clickAt: async (args: TestingPointArgs) => {
			const x = args?.x;
			const y = args?.y;
			if (
				typeof x !== "number" ||
				typeof y !== "number" ||
				!Number.isFinite(x) ||
				!Number.isFinite(y)
			) {
				throw new CrustError("bad-request", "testing.clickAt needs numeric { x, y }");
			}
			return run<ClickedResult>("clickAt", { x, y, label: args?.label });
		},
		/** Focus a field and set its value so the framework's own state updates too. */
		type: async (args: TestingTypeArgs) =>
			run<TypedResult>("type", {
				selector: requireSelector(args),
				text: requireText(args),
				label: args?.label,
			}),
		/** One key press through the page: a synthetic event, so no browser default follows it. */
		key: async (args: TestingKeyArgs) => {
			if (typeof args?.key !== "string" || args.key.length === 0) {
				throw new CrustError("bad-request", 'testing.key needs a non-empty "key"');
			}
			const modifiers: TestingModifiers = args.modifiers ?? {};
			return run<KeyResult>("key", { key: args.key, modifiers, label: args.label });
		},
		/** Move the page's own pointer over an element: `mouseover` and `mousemove` on it. */
		hover: async (args: TestingSelectorArgs) =>
			run<HoveredResult>("hover", {
				selector: requireSelector(args),
				label: args?.label,
			}),
	};
}
