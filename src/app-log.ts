/**
 * The app lifecycle's log lines, split out of `app.ts` so the class stays the lifecycle and the
 * file stays under the line cap. The config summary carries counts, never values: a capability's
 * action patterns and a window's URL are the app's business, and a secret in a config key must
 * never reach a file.
 */

import type { CrustConfig } from "@/config";
import { configureLogger, isLoggerConfigured, logEvent } from "@/logging/logger";
import { appRecord, platformRecord } from "@/logging/records";

import type { Platform } from "./app-types.ts";

/**
 * A bare `bun src/main.ts` run never went through `startApp`, so it configures the log itself — the
 * same defaults, at the same moment `crust dev` would have. `startApp` has already done this before
 * the entry ran, so this is a no-op there and the entry's own log lines are not lost.
 */
export function ensureAppLogger(config: CrustConfig): void {
	if (isLoggerConfigured()) return;
	// A test process runs apps with no temp root; writing into the user's real data directory is a
	// side effect nobody asked for, and the app lines a test wants are configured explicitly.
	if (process.env.NODE_ENV === "test") return;
	configureLogger({
		appId: config.app.id,
		...config.logging,
		dev: process.env.CRUST_DEV === "1",
	});
}

/** Counts only: enough to answer "what did this run start with", never a secret value. */
export function configSummary(config: CrustConfig): Record<string, string | number> {
	const capabilities = config.security?.capabilities?.length ?? 0;
	const grants =
		config.security?.grants === undefined ? 0 : Object.keys(config.security.grants).length;
	return {
		version: config.app.version,
		windows: config.windows.length,
		plugins: config.plugins?.length ?? 0,
		capabilities,
		grants,
	};
}

export function logAppStart(config: CrustConfig, platform: Platform): void {
	logEvent(
		appRecord("app.start", `starting ${config.app.name}`, {
			app: config.app.id,
			platform: process.platform,
			arch: process.arch,
			runtime: process.versions.bun ?? process.versions.node,
			...configSummary(config),
			platformWindows: platform.windowLabels?.().length,
		}),
	);
}

export function logAppReady(platform: Platform): void {
	const labels = platform.windowLabels?.() ?? [];
	logEvent(
		appRecord(
			"app.ready",
			`ready with ${labels.length} window${labels.length === 1 ? "" : "s"}`,
			{
				labels,
			},
		),
	);
}

export function logAppQuit(reason: string): void {
	logEvent(appRecord("app.quit", `quitting: ${reason}`, { reason }));
}

export function logCommandRegistered(name: string): void {
	logEvent(appRecord("app.command.registered", `command ${name} registered`, { name }, "debug"));
}

/** A lifecycle refusal or listener error arrives on the `error` channel; log it with its code. */
export function logLifecycleError(error: Error): void {
	const code = (error as Error & { code?: string }).code ?? error.name;
	const api = (error as Error & { requires?: string }).requires ?? "app.on";
	logEvent(platformRecord({ api, code, detail: error.message, source: "platform" }));
}
