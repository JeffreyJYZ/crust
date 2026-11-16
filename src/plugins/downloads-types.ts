/**
 * The shapes `crust:downloads` speaks, kept apart from the command wiring so the page-side client
 * can be typed from one module and the plugin's own file stays about behaviour.
 */

import type { NotImplemented, PluginContext } from "./define.ts";

/** Where a download stands. `cancelled` is set here, never by WebKit, which reports nothing. */
export type DownloadStatus = "downloading" | "finished" | "failed" | "cancelled";

export interface DownloadEntry {
	id: string;
	url: string;
	/** Absolute path WebKit was told to write; empty until the delegate asked for one. */
	path: string;
	status: DownloadStatus;
	/** 0..1 from WKDownload's NSProgress, so a page can draw a bar without a second command. */
	progress: number;
	/** The failure text, present only when `status` is `"failed"`. */
	error?: string;
}

/** What the native half reports once a download ends. */
export interface DownloadNativeEvent {
	kind: "finished" | "failed";
	id: string;
	/** The file path on `"finished"`, the failure text on `"failed"`. */
	text: string;
}

export interface DownloadsOptions {
	/** The app's data root. Defaults to `~/Library/Application Support/<app>`. */
	root?: string;
	/** Bundle id naming the default root. */
	app?: string;
}

/** The native half of `crust:downloads`; `createDownloadsPlugin` takes it structurally. */
export interface DownloadsAdapter {
	/** Point WebKit at the delegate and the destination directory; idempotent. */
	install(directory: string, sink: (event: DownloadNativeEvent) => void): void;
	/** Ask the page's webview to download `url`; false means the send was refused. */
	start(url: string, id: string): boolean | Promise<boolean>;
	cancel(id: string): boolean | Promise<boolean>;
	/** 0..1, or a negative number when the download is not live. */
	progress(id: string): number;
	/** Retarget future downloads; the delegate reads this on every decision. */
	setDirectory(directory: string): void;
}

/** What `list()` answers, so a page can draw the whole queue from one call. */
export interface DownloadList {
	ok: true;
	directory: string;
	downloads: DownloadEntry[];
}

/** The command map, so `plugin.commands.start` is a function and not `| undefined`. */
export type DownloadsCommands = {
	list: (args: unknown, ctx: PluginContext) => Promise<DownloadList | NotImplemented>;
	start: (
		args: { url?: string },
		ctx: PluginContext,
	) => Promise<{ ok: true; download: DownloadEntry } | NotImplemented>;
	cancel: (
		args: { id?: string },
		ctx: PluginContext,
	) => Promise<{ ok: true; id: string; cancelled: true } | NotImplemented>;
	directory: (
		args: unknown,
		ctx: PluginContext,
	) => Promise<{ ok: true; directory: string } | NotImplemented>;
	setDirectory: (
		args: { path?: string },
		ctx: PluginContext,
	) => Promise<{ ok: true; directory: string } | NotImplemented>;
};
