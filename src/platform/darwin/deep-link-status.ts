/**
 * The install statuses the deep-link C unit answers, and why each one happened. Split out of
 * `deep-link.ts` when that file crossed the 200-line cap — the statuses are a table with a reason
 * per row, and a table is the thing to move rather than a comment to trim.
 */

/** The C unit's install answers; `installed` is the only one a caller accepts. */
export const DEEPLINK_STATUS = {
	installed: 0,
	missing: 1,
	noApplication: 2,
	noClass: 3,
	alreadyInstalled: 4,
	delegateTaken: 5,
	lifecycleMethodFailed: 6,
} as const;

const REASONS: Record<number, string> = {
	[DEEPLINK_STATUS.installed]: "the delegate is installed and receives application:openURLs:",
	[DEEPLINK_STATUS.missing]: "AppKit is missing NSApplication or a selector the delegate needs",
	[DEEPLINK_STATUS.noApplication]:
		"there is no shared NSApplication yet; install after platform.start()",
	[DEEPLINK_STATUS.noClass]: "the CrustDeepLinkDelegate class could not be built",
	[DEEPLINK_STATUS.alreadyInstalled]: "the delegate was already installed",
	[DEEPLINK_STATUS.delegateTaken]:
		"another app delegate is already set; refusing to replace it and lose its handlers",
	[DEEPLINK_STATUS.lifecycleMethodFailed]:
		"the app delegate could not be given a lifecycle callback the runtime needs",
};

/** Why an install answered what it did, including a status this build does not know. */
export function installReason(status: number): string {
	return REASONS[status] ?? `unknown status ${status} while installing the deep-link delegate`;
}
