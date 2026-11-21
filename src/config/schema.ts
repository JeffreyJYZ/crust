/**
 * The crust config shape and its validator: a bad config is a startup failure naming the offending key and the shape it expects, never a silent default. Shapes in `types.ts`, issues in `issues.ts`, checks in `validator.ts` and one `validate-*.ts` per area — all re-exported here so `./schema` stays the import path.
 */

import { ConfigError } from "./issues.ts";
import type { CrustConfig } from "./types.ts";
import { validateApp } from "./validate-app.ts";
import { validateBuild } from "./validate-build.ts";
import { validateDev } from "./validate-dev.ts";
import { validateExtensions } from "./validate-extensions.ts";
import { validateBrowser, validatePreview, validatePty } from "./validate-features.ts";
import { validateFs } from "./validate-fs.ts";
import { validateLogging } from "./validate-logging.ts";
import { validateSecurity } from "./validate-security.ts";
import { validateShell } from "./validate-shell.ts";
import { validateUpdater } from "./validate-updater.ts";
import { validateWindows } from "./validate-windows.ts";
import { Validator } from "./validator.ts";

export { ConfigError } from "./issues.ts";
export * from "./types.ts";

const ROOT_KEYS = [
	"app",
	"windows",
	"dev",
	"build",
	"plugins",
	"extensions",
	"security",
	"fs",
	"shell",
	"updater",
	"logging",
	"pty",
	"preview",
	"browser",
] as const;

/**
 * Validate an already-parsed config object.
 * Throws a ConfigError listing every issue found, not just the first.
 */
export function validateConfig(value: unknown, source = "crust config"): CrustConfig {
	const v = new Validator();
	const root = v.object("config", value);

	if (root) {
		v.only(root, "", ROOT_KEYS);
		validateApp(v, root.app);
		validateWindows(v, root.windows);
		validateDev(v, root.dev);
		validateBuild(v, root.build);

		if (root.plugins !== undefined) v.stringArray(root, "plugins", "config");

		validateExtensions(v, root.extensions);
		validateSecurity(v, root.security);
		validateFs(v, root.fs);
		validateShell(v, root.shell);
		validateUpdater(v, root.updater);
		validateLogging(v, root.logging);
		validatePty(v, root.pty);
		validatePreview(v, root.preview);
		validateBrowser(v, root.browser);
	}

	if (v.issues.length > 0) throw new ConfigError(source, v.issues);
	return value as CrustConfig;
}
