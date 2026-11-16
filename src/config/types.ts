/** One window the app opens at startup. `label` is the key `app.window(label)` uses. */
export interface WindowConfig {
	label: string;
	url?: string;
	width?: number;
	height?: number;
	minWidth?: number;
	title?: string;
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
}

export interface SecurityConfig {
	csp?: string;
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
 * The updater's defaults; the section existing is what registers `crust:updater`, so an app with no
 * update story carries no download-and-replace surface at all.
 */
export interface UpdaterConfig {
	/** Manifest URL `check` falls back to when the page passes none. */
	endpoint?: string;
	/** Base64 of 32 raw bytes: the only signing key this app accepts. */
	pubkey?: string;
	/** Whether the app wants a startup check; `updater.config` reports it. */
	autoCheck?: boolean;
	/** Allow a `file:` url in `updater.download`; https is the only scheme otherwise. */
	allowFileUrl?: boolean;
}

export interface CrustConfig {
	app: AppConfig;
	windows: WindowConfig[];
	dev?: DevConfig;
	build?: BuildConfig;
	plugins?: string[];
	/** Extension files, relative to the project; absent means `extensions/*.ts`. */
	extensions?: string[];
	security?: SecurityConfig;
	fs?: FsConfig;
	shell?: ShellConfig;
	updater?: UpdaterConfig;
}

export interface ConfigIssue {
	/** Dotted path to the offending key, e.g. `windows[0].label`. */
	path: string;
	/** What that key should have been. */
	expected: string;
	/** What was there instead, as short a form as possible. */
	received?: string;
}
