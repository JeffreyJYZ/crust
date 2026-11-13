/**
 * The crust config shape and its validator.
 *
 * A bad config is a startup failure with a message that names the offending key
 * and the shape that key expects, never a silent default.
 */

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

function describe(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null) return "null";
	if (Array.isArray(value)) return value.length === 0 ? "an empty array" : "an array";
	if (typeof value === "string") return `"${value}"`;
	return String(value);
}

export class ConfigError extends Error {
	readonly issues: ConfigIssue[];

	constructor(source: string, issues: ConfigIssue[]) {
		super(formatIssues(source, issues));
		this.name = "ConfigError";
		this.issues = issues;
	}
}

function formatIssues(source: string, issues: ConfigIssue[]): string {
	const lines = [`invalid crust config in ${source}:`];
	for (const issue of issues) {
		const received = issue.received === undefined ? "" : `, got ${issue.received}`;
		lines.push(`  ${issue.path || "config"} — expected ${issue.expected}${received}`);
	}
	return lines.join("\n");
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Validator {
	readonly issues: ConfigIssue[] = [];

	fail(path: string, expected: string, value: unknown): void {
		this.issues.push({ path, expected, received: describe(value) });
	}

	object(path: string, value: unknown): Dict | undefined {
		if (!isDict(value)) {
			this.fail(path, "an object", value);
			return undefined;
		}
		return value;
	}

	only(obj: Dict, path: string, allowed: readonly string[]): void {
		for (const key of Object.keys(obj)) {
			if (!allowed.includes(key)) {
				this.fail(
					path ? `${path}.${key}` : key,
					`one of ${allowed.map((name) => `"${name}"`).join(", ")}`,
					obj[key],
				);
			}
		}
	}

	string(obj: Dict, key: string, path: string, required: boolean): string | undefined {
		const value = obj[key];
		if (value === undefined) {
			if (required) this.fail(`${path}.${key}`, "a non-empty string", value);
			return undefined;
		}
		if (typeof value !== "string" || value.trim() === "") {
			this.fail(`${path}.${key}`, "a non-empty string", value);
			return undefined;
		}
		return value;
	}

	positiveInteger(obj: Dict, key: string, path: string): number | undefined {
		const value = obj[key];
		if (value === undefined) return undefined;
		if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
			this.fail(`${path}.${key}`, "a positive integer", value);
			return undefined;
		}
		return value;
	}

	stringArray(obj: Dict, key: string, path: string): string[] | undefined {
		const value = obj[key];
		if (value === undefined) return undefined;
		if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
			this.fail(`${path}.${key}`, "an array of strings", value);
			return undefined;
		}
		return value as string[];
	}
}

const ROOT_KEYS = ["app", "windows", "dev", "build", "plugins", "security"] as const;
const APP_KEYS = ["id", "name", "version", "icon"] as const;
const WINDOW_KEYS = ["label", "url", "width", "height", "minWidth", "title"] as const;
const DEV_KEYS = ["url", "beforeDevCommand"] as const;
const BUILD_KEYS = ["beforeBuildCommand", "assets", "minimumSystemVersion"] as const;
const SECURITY_KEYS = ["csp"] as const;

/**
 * Validate an already-parsed config object.
 * Throws a ConfigError listing every issue found, not just the first.
 */
export function validateConfig(value: unknown, source = "crust config"): CrustConfig {
	const v = new Validator();
	const root = v.object("config", value);

	if (root) {
		v.only(root, "", ROOT_KEYS);

		const app = v.object("app", root.app);
		if (app) {
			v.only(app, "app", APP_KEYS);
			v.string(app, "id", "app", true);
			v.string(app, "name", "app", true);
			v.string(app, "version", "app", true);
			v.string(app, "icon", "app", false);
		}

		if (root.windows === undefined) {
			v.fail("windows", "a non-empty array of window objects", undefined);
		} else if (!Array.isArray(root.windows)) {
			v.fail("windows", "a non-empty array of window objects", root.windows);
		} else if (root.windows.length === 0) {
			v.fail("windows", "a non-empty array of window objects", root.windows);
		} else {
			root.windows.forEach((item, index) => {
				const path = `windows[${index}]`;
				const window = v.object(path, item);
				if (!window) return;
				v.only(window, path, WINDOW_KEYS);
				v.string(window, "label", path, true);
				v.string(window, "url", path, false);
				v.positiveInteger(window, "width", path);
				v.positiveInteger(window, "height", path);
				v.positiveInteger(window, "minWidth", path);
				v.string(window, "title", path, false);
			});
		}

		if (root.dev !== undefined) {
			const dev = v.object("dev", root.dev);
			if (dev) {
				v.only(dev, "dev", DEV_KEYS);
				v.string(dev, "url", "dev", false);
				v.string(dev, "beforeDevCommand", "dev", false);
			}
		}

		if (root.build !== undefined) {
			const build = v.object("build", root.build);
			if (build) {
				v.only(build, "build", BUILD_KEYS);
				v.string(build, "beforeBuildCommand", "build", false);
				v.string(build, "assets", "build", false);
				v.string(build, "minimumSystemVersion", "build", false);
			}
		}

		if (root.plugins !== undefined) v.stringArray(root, "plugins", "config");

		if (root.security !== undefined) {
			const security = v.object("security", root.security);
			if (security) {
				v.only(security, "security", SECURITY_KEYS);
				v.string(security, "csp", "security", false);
			}
		}
	}

	if (v.issues.length > 0) throw new ConfigError(source, v.issues);
	return value as CrustConfig;
}
