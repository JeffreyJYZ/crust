/**
 * A fake downloads adapter and an event recorder, shared by the `crust:downloads` suite.
 * A test that reached WebKit would download a file onto the machine running it, so every proof
 * injects this instead — and the root is never the real `Application Support`.
 */

import { join, resolve } from "node:path";

import type { DownloadNativeEvent, DownloadsAdapter } from "./downloads-types.ts";

/** The data root every suite uses. */
export const DOWNLOADS_ROOT = "/tmp/crust-downloads-test";

/** The directory `createDownloadsPlugin` defaults to under {@link DOWNLOADS_ROOT}. */
export const DOWNLOADS_DIRECTORY = join(resolve(DOWNLOADS_ROOT), "downloads");

export interface FakeDownloads {
	adapter: DownloadsAdapter;
	/** `"<id> <url>"` per start, so an id that moved is visible. */
	started: string[];
	cancelled: string[];
	/** Every directory the adapter was handed, install first. */
	directories: string[];
	/** Drive a native event the way the delegate would. */
	emit: (event: DownloadNativeEvent) => void;
}

export function fakeDownloads(
	options: { start?: boolean; cancel?: boolean; progress?: number } = {},
): FakeDownloads {
	const started: string[] = [];
	const cancelled: string[] = [];
	const directories: string[] = [];
	let sink: ((event: DownloadNativeEvent) => void) | undefined;
	const adapter: DownloadsAdapter = {
		install(directory, handler) {
			directories.push(directory);
			sink = handler;
		},
		start(url, id) {
			started.push(`${id} ${url}`);
			return options.start ?? true;
		},
		cancel(id) {
			cancelled.push(id);
			return options.cancel ?? true;
		},
		progress() {
			return options.progress ?? -1;
		},
		setDirectory(directory) {
			directories.push(directory);
		},
	};
	return {
		adapter,
		started,
		cancelled,
		directories,
		emit: (event) => sink?.(event),
	};
}

export interface EventRecorder {
	events: { event: string; data: unknown }[];
	ctx: { emit: (event: string, data: unknown) => void };
}

/** A `PluginContext` that keeps every event, in order. */
export function recorder(): EventRecorder {
	const events: { event: string; data: unknown }[] = [];
	return { events, ctx: { emit: (event, data) => events.push({ event, data }) } };
}
