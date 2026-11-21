/**
 * System backdrop behind a window. `vibrancy` is the macOS translucency effect;
 * `mica`, `acrylic` and `tabbed` are Windows 11 backdrops; `none` is the opaque
 * default. Validation refuses a value the current platform cannot apply —
 * `tabbed` is Windows-only and is refused on macOS and Linux by name.
 */
export type WindowMaterial = "vibrancy" | "mica" | "acrylic" | "tabbed" | "none";

import type { TestingConfig } from "./types-testing.ts";

export * from "./types-testing.ts";

/** One window the app opens at startup. `label` is the key `app.window(label)` uses. */
export interface WindowConfig {
	label: string;
	url?: string;
	width?: number;
	height?: number;
	minWidth?: number;
	minHeight?: number;
	title?: string;
	/** Backdrop behind the webview. Absent is `none`. */
	material?: WindowMaterial;
}

/**
 * Whether creating a window brings the app to the front.
 *
 * `always` (default) raises the app on every window create, which is what puts the window on the
 * active Space and therefore into AppKit's `AXWindows`. `first` raises only for the first window
 * this process creates: a closed-and-reopened window does not count as first again, and a later
 * window created while another app is frontmost stays off the active Space and out of `AXWindows`
 * until the user activates the app. `never` sends no activation selector at all, so every window
 * created while the app is inactive has that symptom — on screen, and invisible to VoiceOver.
 */
export type ActivateMode = "always" | "first" | "never";

export interface AppConfig {
	/** Reverse-DNS bundle identifier written to Info.plist. */
	id: string;
	name: string;
	version: string;
	icon?: string;
	/** When a window create brings the app forward. Defaults to `always`. */
	activate?: ActivateMode;
}

export interface DevConfig {
	/** Vite (or any dev server) origin the window loads in `crust dev`. */
	url?: string;
	beforeDevCommand?: string;
}

export interface BuildConfig {
	beforeBuildCommand?: string;
	/**
	 * Directory whose tree `crust build` embeds, relative to the project. Defaults
	 * to `public`; a frontend that builds elsewhere names its output (e.g.
	 * `dist/web` for Vite). Whoever sets it is promising an `index.html` there.
	 */
	assets?: string;
	/** LSMinimumSystemVersion in Info.plist. */
	minimumSystemVersion?: string;
	/**
	 * A custom URL scheme the bundle claims (`crust://…`). Written into the
	 * bundle's `Info.plist` as `CFBundleURLTypes`, which is what makes macOS
	 * hand those URLs to this app instead of opening a browser.
	 */
	urlScheme?: string;
	/**
	 * Executables shipped inside the bundle and reachable through the `sidecar` plugin.
	 * Each entry is a path relative to the project; `crust build` copies it beside the
	 * app's binary (0755), and a page may spawn it by that exact relative path.
	 */
	sidecars?: string[];
}

/** One grant a window label can hold. A window names capabilities by `name`. */
export interface CapabilityConfig {
	/** What this grant is called; a window names capabilities by these. */
	name: string;
	/** Command patterns: `dialog:*`, `fs:read*`, or the exact `shell.spawn`. */
	actions: string[];
}

export interface SecurityConfig {
	csp?: string;
	/** Capabilities. Absent or empty means every command is allowed — the behaviour today. */
	capabilities?: CapabilityConfig[];
	/** Which capabilities each window label holds. A label with no entry holds none. */
	grants?: Record<string, string[]>;
	/**
	 * The sentence macOS shows in its microphone prompt, e.g. "Example records voice memos you
	 * choose to transcribe." Present enables capture: `NSMicrophoneUsageDescription` in the
	 * bundle's Info.plist, `com.apple.security.device.audio-input` under the hardened runtime,
	 * and a grant for the webview's media-capture request. macOS only for now — Windows
	 * (WebView2's `PermissionRequested` with `Microphone`) and Linux (WebKitGTK's
	 * `permission-request` signal) still deny capture because neither platform handles it.
	 */
	microphone?: string;
}

/** What `crust:shell` may run; absent means nothing, because the allowlist is deny-by-default. */
export interface ShellConfig {
	/** Program names, or absolute paths, a page may spawn. */
	allow?: string[];
	/** Directory every `cwd` and every path-form program must stay inside. */
	cwdRoot?: string;
}

/** What `crust:fs` may touch. Absent means no restriction, which is every app that never configures it. */
export interface FsConfig {
	/** Absolute path prefixes every `fs` command must resolve inside. */
	scope?: string[];
}

/**
 * The framework's own structured log. Absent means the defaults: `info`, files only, `logs/`, three
 * generations of 5 MiB. `crust dev` streams every written record to the terminal but no longer
 * raises the level; `--log-level` then `CRUST_LOG` beat this key, which beats the default.
 */
export interface LoggingConfig {
	/** Minimum level written: `trace | debug | info | warn | error`. */
	level?: "trace" | "debug" | "info" | "warn" | "error";
	/** Mirror warn and above to stderr. In `crust dev`, every written record does. */
	console?: boolean;
	/** Directory under the app data root, relative. Defaults to `logs`. */
	dir?: string;
	/** `app.jsonl` archives kept. Defaults to 3. */
	generations?: number;
	/** Live-file size that starts a rotation. Defaults to 5 MiB. */
	maxBytes?: number;
}

/**
 * The updater's defaults; the section existing is what registers `crust:updater`, so an app with no
 * update story carries no download-and-replace surface at all.
 */
export interface UpdaterConfig {
	/** Manifest URL `check` falls back to when the page passes none. */
	endpoint?: string;
	/** Base64 of 32 raw bytes: the only signing key this app accepts. */
	pubkey?: string;
	/**
	 * Reported by `updater.config` and nothing else: crust starts no check on its own, so an app
	 * that wants one calls `updater.check` from `main.ts`. Set it and it is still only echoed back.
	 */
	autoCheck?: boolean;
	/** Allow a `file:` url in `updater.download`; https is the only scheme otherwise. */
	allowFileUrl?: boolean;
}

/**
 * `crust:pty` — a terminal a page can drive. The section existing is what registers the plugin: a
 * page-reachable pty is command execution, so it must be declared, never inherited from `plugins`.
 */
export interface PtyConfig {
	/** Program the terminal runs; absent is the user's login shell. */
	shell?: string;
}

/** `crust:preview` — the embedded panel's default size in points. Absent still registers it. */
export interface PreviewConfig {
	width?: number;
	height?: number;
}

/**
 * `crust:browser` — the `http(s)` origins an embedded surface may load. Absent still registers the
 * plugin, with nothing allowed, so no URL loads until one is named here.
 */
export interface BrowserConfig {
	/** An origin is scheme and host only: `https://example.com`, never a path. */
	origins?: string[];
}

export interface CrustConfig {
	app: AppConfig;
	windows: WindowConfig[];
	/**
	 * How a probe run treats activation. Absent is `auto`, which is today's launch; a probe that
	 * must not steal focus sets `none` or `on-demand`.
	 */
	testing?: TestingConfig;
	dev?: DevConfig;
	build?: BuildConfig;
	plugins?: string[];
	/** Extension files, relative to the project; absent means `extensions/*.ts`. */
	extensions?: string[];
	security?: SecurityConfig;
	fs?: FsConfig;
	shell?: ShellConfig;
	updater?: UpdaterConfig;
	logging?: LoggingConfig;
	pty?: PtyConfig;
	preview?: PreviewConfig;
	browser?: BrowserConfig;
}

export type { ConfigIssue } from "./issues.ts";
