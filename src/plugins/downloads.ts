/**
 * `crust:downloads` — files the page asks WebKit to save. This module owns no framework: macOS
 * supplies `darwinDownloadsAdapter()`, and a platform without WebKit keeps answering a typed
 * `NotImplemented`.
 * The plugin owns the ids, the entries and the events; the adapter owns WebKit. A native finish or
 * failure arrives through the sink the adapter was installed with, so the page hears about it
 * without polling.
 */

import { join, resolve } from "node:path";

import { CrustError } from "../bridge/errors";
import {
	definePlugin,
	notImplemented,
	type PluginContext,
	type PluginDefinition,
} from "./define.ts";
import { destination, requireText } from "./downloads-scope.ts";
import type {
	DownloadEntry,
	DownloadsAdapter,
	DownloadsCommands,
	DownloadsOptions,
} from "./downloads-types.ts";
import { defaultStateRoot } from "./window-persist-store.ts";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function createDownloadsPlugin(
	adapter?: DownloadsAdapter,
	options: DownloadsOptions = {},
): PluginDefinition<"downloads", DownloadsCommands> {
	const native = adapter;
	const root = resolve(options.root ?? defaultStateRoot(options.app ?? "crust"));
	let directory = join(root, "downloads");
	const entries = new Map<string, DownloadEntry>();
	let context: PluginContext | undefined;
	let installed = false;
	let counter = 0;

	const missing = (command: string) =>
		notImplemented(
			`downloads.${command} needs WKDownloadDelegate, which only WebKit provides. Pass a DownloadsAdapter to createDownloadsPlugin on a platform that has no webkit.`,
			"WKDownloadDelegate",
		);

	/** One delegate for the process: WebKit holds it, and a second install would replace it. */
	const install = (): void => {
		if (installed || !native) return;
		installed = true;
		native.install(directory, (event) => {
			const entry = entries.get(event.id);
			// A cancelled or already-finished entry is settled: a late native event must not
			// resurrect it, and WebKit does report a cancelled download as an error.
			if (!entry || entry.status !== "downloading") return;
			if (event.kind === "finished") {
				entry.status = "finished";
				entry.progress = 1;
				entry.path = event.text;
				context?.emit("download:finished", { ...entry });
				return;
			}
			entry.status = "failed";
			entry.error = event.text;
			context?.emit("download:failed", { ...entry });
		});
	};

	const commands: DownloadsCommands = {
		/** Every download this process started, with the progress read at this moment. */
		list: async (_args, ctx) => {
			if (!native) return missing("list");
			context = ctx;
			install();
			for (const entry of entries.values()) {
				if (entry.status !== "downloading") continue;
				const progress = native.progress(entry.id);
				if (!(progress >= 0) || progress === entry.progress) continue;
				entry.progress = progress;
				context?.emit("download:progress", { ...entry });
			}
			return { ok: true, directory, downloads: [...entries.values()] };
		},
		/** Start a download of `url` from the page's webview. */
		start: async (args, ctx) => {
			if (!native) return missing("start");
			context = ctx;
			const url = requireText(args?.url, "start", "url");
			if (!SCHEME.test(url)) {
				throw new CrustError(
					"bad-request",
					`downloads.start: "${url}" has no scheme, so it is not a URL`,
				);
			}
			install();
			const id = `dl-${++counter}`;
			if (!(await native.start(url, id))) {
				throw new CrustError(
					"handler-error",
					`downloads.start: the webview refused ${url}`,
				);
			}
			const entry: DownloadEntry = {
				id,
				url,
				path: "",
				status: "downloading",
				progress: 0,
			};
			entries.set(id, entry);
			ctx.emit("download:started", { ...entry });
			return { ok: true, download: entry };
		},
		/** Cancel a running download. A finished or failed one is a bad request, not a no-op. */
		cancel: async (args, ctx) => {
			if (!native) return missing("cancel");
			context = ctx;
			const id = requireText(args?.id, "cancel", "id");
			const entry = entries.get(id);
			if (!entry)
				throw new CrustError("bad-request", `downloads.cancel: no download "${id}"`);
			if (entry.status !== "downloading") {
				throw new CrustError(
					"bad-request",
					`downloads.cancel: "${id}" is ${entry.status}, not downloading`,
				);
			}
			if (!(await native.cancel(id))) {
				throw new CrustError(
					"handler-error",
					`downloads.cancel: WebKit did not cancel "${id}"`,
				);
			}
			entry.status = "cancelled";
			return { ok: true, id, cancelled: true };
		},
		/** The directory new downloads are written to. */
		directory: async (_args, ctx) => {
			if (!native) return missing("directory");
			context = ctx;
			return { ok: true, directory };
		},
		/** Move the destination, refusing anything outside the app's data root. */
		setDirectory: async (args, ctx) => {
			if (!native) return missing("setDirectory");
			context = ctx;
			const target = destination(root, requireText(args?.path, "setDirectory", "path"));
			install();
			directory = target;
			native.setDirectory(target);
			return { ok: true, directory };
		},
	};

	return definePlugin({ name: "downloads", commands });
}

/** The default registration: honest about the missing framework. */
export const downloadsPlugin = createDownloadsPlugin();
