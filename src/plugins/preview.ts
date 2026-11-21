/**
 * `crust:preview` — the embedded panel a page shows a file in: `preview.show({ path, width?, height? })`
 * and `preview.hide()`. Always registered; an absent `preview` section only means the panel's own
 * default size.
 *
 * **A preview is a file read**, so the path goes through the same `fs.scope` containment `fs` uses:
 * absolute first, then the scope's own canonical check, which is what refuses a `..` walk, a symlink
 * out of a prefix, and the scope store's own path. The boundary is the runtime's instance when the app
 * configured `fs.scope`, so a prefix `fs.scopeAllow` added at runtime bounds a preview too.
 *
 * **A platform that cannot preview says so.** macOS has `QLPreviewPanel`, Windows has the
 * `IPreviewHandler` host but no window handed to this registration, and Linux has no embedded system
 * preview API at all — each answers `not-implemented` naming what it waits on rather than opening the
 * file in another app behind a command called `show`.
 */

import {
	definePlugin,
	isNotImplemented,
	type NotImplemented,
	notImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define";
import { createFsScope, type FsScopeOptions } from "./fs-scope.ts";
import { type ScopeCheck, scopedFsScope } from "./fs-scope-in-force.ts";
import { canonical } from "./fs-scope-path.ts";
import { readShow, type ShowArgs, type ShowDefaults } from "./preview-args.ts";
import {
	isPreviewFailure,
	type PreviewFailure,
	type PreviewSurface,
	resolvePreviewSurface,
} from "./preview-surface.ts";

export type { ShowArgs } from "./preview-args.ts";
export type {
	DarwinAdapter,
	PreviewFailure,
	PreviewSurface,
	SurfaceAnswer,
	SurfaceRefused,
} from "./preview-surface.ts";

export interface PreviewPluginOptions extends FsScopeOptions {
	/** `preview.width` from the config: the size when the page passes none. */
	width?: number;
	/** `preview.height` from the config. */
	height?: number;
	/** An explicit surface, for a test or a host mounting its own platform half. */
	surface?: PreviewSurface;
	/** An explicit scope. Defaults to the ambient `fs.scope` instance, else `allow`. */
	scope?: ScopeCheck;
}

/** A panel that is up. `visible` is the panel's own answer, not this call's return value. */
export interface PreviewShown {
	ok: true;
	path: string;
	width: number;
	height: number;
	visible: boolean;
	/** The panel's own window number where the platform has one, else 0. */
	window: number;
}

export type PreviewHideResult = { ok: true; visible: boolean } | PreviewFailure | NotImplemented;

export type PreviewCommands = {
	show: (
		args: ShowArgs,
		ctx?: PluginContext,
	) => Promise<PreviewShown | PreviewFailure | NotImplemented>;
	hide: () => Promise<PreviewHideResult>;
};

export function createPreviewPlugin(
	options: PreviewPluginOptions = {},
	os: string = process.platform,
): PluginDefinition<"preview", PreviewCommands> {
	const defaults: ShowDefaults = {
		width: options.width,
		height: options.height,
	};
	// An explicit `allow` is the host naming its own boundary; otherwise the runtime's configured
	// `fs.scope` instance is inherited, so one boundary governs both namespaces. Resolved *per call*
	// because the registration runs before the `fs` plugin exists: a scope captured at construction
	// would be the unscoped fallback in every app.
	let own: ScopeCheck | undefined;
	const scope = (): ScopeCheck => {
		if (options.scope !== undefined) return options.scope;
		if (options.allow !== undefined) return (own ??= createFsScope(options));
		return scopedFsScope() ?? (own ??= createFsScope());
	};

	const surface = async (): Promise<PreviewSurface | NotImplemented> =>
		options.surface ?? (await resolvePreviewSurface(os));

	return definePlugin({
		name: "preview",
		commands: {
			show: async (
				args: ShowArgs,
				ctx?: PluginContext,
			): Promise<PreviewShown | PreviewFailure | NotImplemented> => {
				const request = readShow(args, defaults);
				// Check the same bytes the platform will open. The canonical path is what the scope
				// resolved and authorised; handing the caller's raw string to QuickLook left a window
				// in which a symlink swap could redirect the panel outside the boundary (TOCTOU).
				const approved = await canonical(request.path);
				// `outside-scope` here is the same CrustError `fs` throws, so the wire carries the code
				// and a sentence naming the path rather than a preview that quietly did nothing.
				await scope().check(approved);
				const target = await surface();
				if (isNotImplemented(target)) return target;
				const answer = target.show({ ...request, path: approved, window: ctx?.window });
				if (!answer.ok) {
					return isPreviewFailure(answer)
						? answer
						: notImplemented(answer.message, answer.requires);
				}
				return {
					ok: true,
					path: request.path,
					width: request.width,
					height: request.height,
					visible: target.visible(),
					window: answer.window,
				};
			},
			hide: async (): Promise<PreviewHideResult> => {
				const target = await surface();
				if (isNotImplemented(target)) return target;
				const answer = target.hide();
				if (!answer.ok) {
					return isPreviewFailure(answer)
						? answer
						: notImplemented(answer.message, answer.requires);
				}
				return { ok: true, visible: target.visible() };
			},
		},
	});
}
