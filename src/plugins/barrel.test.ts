/**
 * The barrel's contract, so the split by area cannot quietly lose a name: every export a page or
 * an app may import is reachable from `src/plugins/index.ts`, none of them is `undefined` (an
 * ambiguous `export *` drops a name instead of failing, which is why this list is checked), and
 * the adapter-free set registers each plugin exactly once.
 *
 * The list is the surface as it stood before the split; a new plugin adds its name here.
 */

import { describe, expect, test } from "bun:test";
import * as barrel from "./index";
import { corePlugins, coreRegistry } from "./index";

/** Every value export of `src/plugins/index.ts`. Types are compile-time only and cannot be listed. */
const EXPORTED = [
	"DATABASE_SUFFIX",
	"ED25519_PUBKEY_BYTES",
	"ED25519_SIGNATURE_BYTES",
	"KDF_ITERATIONS",
	"KDF_NAME",
	"NETWORK_LOG_LIMIT",
	"NETWORK_SCHEME",
	"NotImplementedError",
	"POWER_COMMANDS",
	"PluginRegistry",
	"RING_SIZE",
	"SALT_BYTES",
	"SCREEN_COMMANDS",
	"SHELL_OUTPUT_LINES",
	"STORE_FILE",
	"STORE_VERSION",
	"THEME_CHANGED",
	"WINDOW_COMMANDS",
	"WindowAdapterError",
	"accessibilityPlugin",
	"autostartPlugin",
	"clipboardPlugin",
	"corePlugins",
	"coreRegistry",
	"crashReporterPlugin",
	"createAccessibilityPlugin",
	"createAutostartPlugin",
	"createClipboardPlugin",
	"createCrashReporterPlugin",
	"createDeepLink",
	"createDatabasePlugin",
	"createDialogPlugin",
	"createDockPlugin",
	"createDownloadsPlugin",
	"createFindInPagePlugin",
	"createFsPlugin",
	"createI18nPlugin",
	"createLoggingPlugin",
	"createMenuPlugin",
	"createNavigationPlugin",
	"createNetworkPlugin",
	"createNotificationPlugin",
	"createOpenerPlugin",
	"createOsPlugin",
	"createPositionerPlugin",
	"createPowerPlugin",
	"createScreenPlugin",
	"createShellPlugin",
	"createShortcutsPlugin",
	"createSingleInstancePlugin",
	"createStorePlugin",
	"createStrongholdPlugin",
	"createThemePlugin",
	"createTrayPlugin",
	"createUpdaterPlugin",
	"createWindowPlugin",
	"createWindowStatePlugin",
	"databaseFile",
	"databasePlugin",
	"databaseRoot",
	"decodeBase64",
	"deepLink",
	"defaultStoreRoot",
	"definePlugin",
	"dialogPlugin",
	"dockPlugin",
	"downloadsPlugin",
	"ensureDatabaseFile",
	"findinpagePlugin",
	"fsPlugin",
	"handlerMap",
	"i18nPlugin",
	"isEd25519Pubkey",
	"isLogLevel",
	"isNotImplemented",
	"isSignature",
	"loggingPlugin",
	"menuPlugin",
	"navigationPlugin",
	"networkPlugin",
	"nodeUpdaterAdapter",
	"notImplemented",
	"notificationPlugin",
	"openerPlugin",
	"osPlugin",
	"parseDeepLink",
	"parseManifest",
	"positionerPlugin",
	"powerPlugin",
	"readSignatureArgs",
	"screenPlugin",
	"shortcutsPlugin",
	"signatureMismatch",
	"singleInstancePlugin",
	"storePlugin",
	"strongholdPlugin",
	"themePlugin",
	"trayPlugin",
	"updaterPlugin",
	"verifyEd25519",
	"windowPlugin",
	"windowStatePlugin",
] as const;

/** The namespace read as a record, because a module namespace has no string index signature. */
const surface = barrel as unknown as Record<string, unknown>;

describe("the plugin barrel", () => {
	test("exports every name in the checked-in list", () => {
		const missing = EXPORTED.filter((name) => !(name in surface));
		expect(missing).toEqual([]);
	});

	test("no export is undefined", () => {
		const undefinedNames = Object.keys(surface).filter((name) => surface[name] === undefined);
		expect(undefinedNames).toEqual([]);
	});
});

describe("coreRegistry", () => {
	test("registers every core plugin exactly once", () => {
		const registry = coreRegistry();
		const names = corePlugins.map((plugin) => plugin.name);
		// A duplicate in `corePlugins` would throw here, so the count is the proof of "once".
		expect(registry.size).toBe(names.length);
		expect([...registry.names()].sort()).toEqual([...names].sort());
		expect(new Set(names).size).toBe(names.length);
	});
});
