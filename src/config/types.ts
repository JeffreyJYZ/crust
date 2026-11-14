/** One window the app opens at startup. `label` is the key `app.window(label)` uses. */
export interface WindowConfig {
	label: string;
	url?: string;
	width?: number;
	height?: number;
	minWidth?: number;
	title?: string;
}

export interface AppConfig {
	/** Reverse-DNS bundle identifier written to Info.plist. */
	id: string;
	name: string;
	version: string;
	icon?: string;
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
}

export interface SecurityConfig {
	csp?: string;
}

export interface CrustConfig {
	app: AppConfig;
	windows: WindowConfig[];
	dev?: DevConfig;
	build?: BuildConfig;
	plugins?: string[];
	security?: SecurityConfig;
}

export interface ConfigIssue {
	/** Dotted path to the offending key, e.g. `windows[0].label`. */
	path: string;
	/** What that key should have been. */
	expected: string;
	/** What was there instead, as short a form as possible. */
	received?: string;
}
