/**
 * `crust:window` — window control: create, close, focus, title, list, isOpen.
 *
 * `NSWindow` is AppKit, and this module owns no AppKit. It takes the native
 * implementation as a parameter, so the platform half stays in
 * `platform/darwin` and this file works unchanged on a platform that has none.
 * macOS supplies `darwinWindowAdapter()` from there; without an adapter every
 * command returns a typed `NotImplemented` naming the selector, never a silent
 * undefined and never a resolved fake.
 *
 * `create` is the one command whose native half is *optional*: it arrived after
 * the first five, so an adapter written before it still satisfies
 * {@link WindowNative} and answers `unknown-adapter` here rather than failing to
 * compile. The macOS adapter's `create` is a delegation to
 * `DarwinPlatform.createWindow`, which already owns the `initWithContentRect:`
 * path, the webview and Auto Layout; this file never grows a second one. Its
 * ordering rules live in `window-create.ts`.
 *
 * The adapter contract carries rules the type cannot express: a label it does
 * not track throws `WindowAdapterError("unknown-window")`, and a label it
 * already holds throws `WindowAdapterError("duplicate-label")` instead of
 * replacing the entry — `DarwinPlatform` keeps a closed window addressable, so
 * only it can tell "gone from `list`" from "still in the map". The plugin turns
 * both into values rather than letting a throw escape into the bridge, so a page
 * always gets a shape it can branch on.
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
