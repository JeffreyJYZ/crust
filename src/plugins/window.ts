/**
 * `crust:window` — create, close, focus, title, list, isOpen. `NSWindow` is AppKit and this module owns none: the native half is a parameter, so it works unchanged on a platform with none, and without an adapter every command returns a typed `NotImplemented` naming the selector — never a silent undefined, never a resolved fake.
 * `create` is the one command whose native half is optional (it postdates the other five), so an old adapter still compiles and answers `unknown-adapter`; its macOS implementation is `DarwinPlatform.createWindow`, and this file never grows a second one. The adapter contract carries rules the type cannot: an untracked label throws `WindowAdapterError("unknown-window")` and one already held throws `duplicate-label` rather than replacing the entry — `DarwinPlatform` keeps a closed window addressable, so only it can tell "gone from `list`" from "still in the map". Both become values before the bridge.
 */

import { definePlugin, type NotImplemented, type PluginDefinition } from "./define";
import { failure, invalidLabel, knownWindow, missingWindow, readLabel } from "./window-args.ts";
import { createWindowCommand } from "./window-create.ts";
import type {
	WindowCloseResult,
	WindowCreateArgs,
	WindowCreateResult,
	WindowFailure,
	WindowFocusResult,
	WindowLabelArgs,
	WindowListResult,
	WindowNative,
	WindowOpenResult,
	WindowSetTitleArgs,
	WindowTitleResult,
} from "./window-types.ts";

export * from "./window-types.ts";

export function createWindowPlugin(adapter?: WindowNative): PluginDefinition<
	"window",
	{
		create: (args: WindowCreateArgs) => WindowCreateResult | WindowFailure | NotImplemented;
		close: (args: WindowLabelArgs) => WindowCloseResult | WindowFailure | NotImplemented;
		focus: (args: WindowLabelArgs) => WindowFocusResult | WindowFailure | NotImplemented;
		setTitle: (args: WindowSetTitleArgs) => WindowTitleResult | WindowFailure | NotImplemented;
		list: () => WindowListResult | WindowFailure | NotImplemented;
		isOpen: (args: WindowLabelArgs) => WindowOpenResult | WindowFailure | NotImplemented;
	}
> {
	const act = <Result>(
		command: string,
		run: (native: WindowNative, label: string) => Result,
		args: unknown,
	): Result | WindowFailure | NotImplemented => {
		if (!adapter) return missingWindow(command);
		const native = adapter;
		const label = readLabel(args);
		if (label === undefined) return invalidLabel(args);
		const unknown = knownWindow(native, label);
		if (unknown) return unknown;
		try {
			return run(native, label);
		} catch (error) {
			return failure(error, label);
		}
	};

	return definePlugin({
		name: "window",
		commands: {
			create: (args: WindowCreateArgs) => createWindowCommand(adapter, args),
			close: (args: WindowLabelArgs) =>
				act(
					"close",
					(native, label) => {
						native.close(label);
						return { ok: true as const, label, closed: true as const };
					},
					args,
				),
			focus: (args: WindowLabelArgs) =>
				act(
					"focus",
					(native, label) => {
						native.focus(label);
						return { ok: true as const, label, focused: true as const };
					},
					args,
				),
			setTitle: (args: WindowSetTitleArgs) => {
				if (!adapter) return missingWindow("setTitle");
				const native = adapter;
				const label = readLabel(args);
				if (label === undefined) return invalidLabel(args);
				const title = typeof args?.title === "string" ? args.title : undefined;
				if (title === undefined) {
					return {
						ok: false as const,
						code: "invalid-label" as const,
						message:
							"crust: window.setTitle needs { label, title } with a string title",
						label,
					};
				}
				const unknown = knownWindow(native, label);
				if (unknown) return unknown;
				try {
					native.setTitle(label, title);
					return { ok: true as const, label, title };
				} catch (error) {
					return failure(error, label);
				}
			},
			list: () => {
				if (!adapter) return missingWindow("list");
				try {
					return { ok: true as const, labels: [...adapter.list()] };
				} catch (error) {
					return failure(error);
				}
			},
			isOpen: (args: WindowLabelArgs) =>
				act(
					"isOpen",
					(native, label) => ({ ok: true as const, label, open: native.isOpen(label) }),
					args,
				),
		},
	});
}

/** The default registration: honest about the missing platform. */
export const windowPlugin = createWindowPlugin();
