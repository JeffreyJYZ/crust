/**
 * The typed answer `autostart` gives a page: which file an answer is about, the two failure shapes
 * worth branching on, and the adapter a test injects. Split from `autostart.ts` so the OS choice and
 * the contract can be read apart.
 */

/** Where the entry goes. `home` is injected so a test never writes the real `~/Library`. */
export interface AutostartAdapter {
	home: string;
	/** The id the entry is named for; `enable` falls back to the app's own `Info.plist`. */
	bundleId?: string;
	/** Replaces `$XDG_CONFIG_HOME`; defaults to `<home>/.config`, the spec's fallback. */
	configHome?: string;
	/** `process.platform`, injected so the win32 refusal and the linux entry are provable off those OSes. */
	platform?: string;
}

export type AutostartFailureCode =
	"bad-request" | "not-found" | "handler-error" | "unsupported-platform";

export interface AutostartFailure {
	ok: false;
	code: AutostartFailureCode;
	message: string;
}

export interface AutostartStatus {
	ok: true;
	enabled: boolean;
	/** Absolute path of the file this answer is about: the LaunchAgent plist, or the `.desktop` entry. */
	path: string;
}

export type AutostartResult = AutostartStatus | AutostartFailure;

export interface EnableArgs {
	/** Absolute path of the `.app` bundle, or of the executable on Linux. */
	appPath: string;
	bundleId?: string;
}

export interface AutostartIdArgs {
	bundleId?: string;
}
