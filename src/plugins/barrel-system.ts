/**
 * The app-level services: a panel, a banner, a status item, the launch hook, the log ring, the
 * update manifest, the single-instance lock, the URL the OS opened, and the language catalogue.
 * None of them own a window; each either needs an adapter or needs nothing at all.
 *
 * Re-exports only, so `index.ts` stays a map of the plugin surface rather than the surface itself.
 */

export {
	createDialogPlugin,
	type CancelPanelResult,
	type DialogNative,
	dialogPlugin,
	type OpenPanelOptions,
	type OpenPanelResult,
	type SavePanelOptions,
	type SavePanelResult,
} from "./dialog";
export {
	createNotificationPlugin,
	type NotificationNative,
	type NotificationPermission,
	type NotifyOptions,
	type NotifyResult,
	notificationPlugin,
} from "./notification";
export {
	createTrayPlugin,
	type TrayNative,
	trayPlugin,
	type TrayOptions,
	type TrayResult,
} from "./tray";
export { createAutostartPlugin, autostartPlugin, type AutostartAdapter } from "./autostart";
export {
	createKeychainPlugin,
	KEYCHAIN_COMMANDS,
	keychainPlugin,
	type KeychainAdapter,
	type KeychainDeleteResult,
	type KeychainFailure,
	type KeychainGetResult,
	type KeychainKeyArgs,
	type KeychainListResult,
	type KeychainSetArgs,
	type KeychainSetResult,
} from "./keychain";
export {
	createUpdaterPlugin,
	decodeBase64,
	ED25519_PUBKEY_BYTES,
	ED25519_SIGNATURE_BYTES,
	isEd25519Pubkey,
	isSignature,
	nodeUpdaterAdapter,
	parseManifest,
	readSignatureArgs,
	type SignatureArgs,
	signatureMismatch,
	type UpdaterAdapter,
	type UpdaterError,
	type UpdaterErrorCode,
	type UpdaterFailure,
	type UpdaterOptions,
	updaterPlugin,
	type UpdateManifest,
	verifyEd25519,
} from "./updater";
export {
	createLoggingPlugin,
	isLogLevel,
	loggingPlugin,
	RING_SIZE,
	type LogLevel,
	type LoggingAdapter,
} from "./logging";
export {
	createDeepLink,
	deepLink,
	parseDeepLink,
	type DeepLink,
	type DeepLinkOptions,
	type DeepLinkPlugin,
	type DeepLinkTarget,
} from "./deep-link";
export {
	type AcquireResult,
	type ActivateArgs,
	type ActivatePost,
	type ActivateResult,
	createSingleInstancePlugin,
	type ReleaseResult,
	type SingleInstanceAdapter,
	type SingleInstanceArgs,
	type SingleInstanceOptions,
	singleInstancePlugin,
} from "./single-instance";
export {
	createI18nPlugin,
	type I18nAdapter,
	type I18nOptions,
	type I18nPlugin,
	i18nPlugin,
	type LocaleResult,
	type MessageCatalogue,
	type MessageTable,
	type TranslationResult,
	type TranslateVars,
} from "./i18n";
export {
	createCrashReporterPlugin,
	crashReporterPlugin,
	type ClearCrashesResult,
	type CrashArmResult,
	type CrashGuardState,
	type CrashNative,
	type CrashReporterOptions,
	type InstallResult,
	type LastCrashResult,
	type ListCrashesArgs,
	type ListCrashesResult,
	type UninstallResult,
} from "./crash-reporter";
