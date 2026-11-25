/**
 * The last hunt-22 darwin finding: four runtime delegate classes were left half-built when a
 * selector could not be added. Each driver fails one class_addMethod at a time, then retries the
 * same registration. The retry can only succeed if the failed attempt disposed the class pair —
 * the stub refuses a second allocation while the first pair is still live. No AppKit, no window,
 * no focus, no screenshot: the evidence is a compiled C driver against a fake ObjC runtime.
 */

import { describe, expect, test } from "bun:test";

import { auditSource } from "./shim-audit.ts";
import { probeWith, STUB_CLASS_NAMED } from "./ownership-harness.ts";

/** A failed attempt must dispose exactly once; a retry must allocate a fresh pair. */
const RETRY = 100;

describe("the navigation delegate disposes every failed selector", () => {
	// Six selectors, one refusal each: the first, the middle and the last are all drivable.
	const driver = `
// The policy IMP is defined in 110_navigation_policy.c, joined only in the product build.
static void nav_decide_policy(void *self, void *cmd, void *web, void *action, void *handler) {
	(void)self; (void)cmd; (void)web; (void)action; (void)handler;
}
int test_nav_class(void) {
	for (int at = 1; at <= 6; at++) {
		dispose_calls = 0; allocate_calls = 0; add_calls = 0; class_live = 0; fail_add_at = at;
		if (nav_class() != 0) return -10 - at;
		if (dispose_calls != 1 || allocate_calls != 1) return -20 - at;
		if (!nav_class()) return -30 - at;
		if (dispose_calls != 1 || allocate_calls != 2) return -40 - at;
	}
	return ${RETRY};
}
`;
	test("nav_class disposes and a failed name does not block the retry", () => {
		expect(probeWith(STUB_CLASS_NAMED, ["107_navigation.c"], driver, "test_nav_class")).toBe(
			RETRY,
		);
	});
});

describe("the media delegate disposes its only failed selector", () => {
	const driver = `
int test_media_class(void) {
	fail_add_at = 1;
	if (media_class() != 0) return -1;
	if (dispose_calls != 1 || allocate_calls != 1) return -2;
	if (!media_class()) return -3;
	return ${RETRY};
}
`;
	test("media_class disposes and the retry rebuilds the class", () => {
		expect(
			probeWith(STUB_CLASS_NAMED, ["122_media_capture.c"], driver, "test_media_class"),
		).toBe(RETRY);
	});
});

describe("the deep-link delegate disposes openURLs and lifecycle failures", () => {
	// Selector 1 is application:openURLs:; 2-5 are the four lifecycle selectors in order.
	const driver = `
int test_dl_class(void) {
	for (int at = 1; at <= 5; at++) {
		dispose_calls = 0; allocate_calls = 0; add_calls = 0; class_live = 0; fail_add_at = at;
		int status = 99;
		if (dl_class(&status) != 0) return -10 - at;
		if (status != (at == 1 ? 3 : 6) || dispose_calls != 1) return -20 - at;
		if (!dl_class(&status)) return -30 - at;
		if (dispose_calls != 1 || allocate_calls != 2) return -40 - at;
	}
	return ${RETRY};
}
`;
	test("dl_class disposes on every refusal and the retry succeeds", () => {
		expect(
			probeWith(
				STUB_CLASS_NAMED,
				["95_deeplink.c", "117_lifecycle.c"],
				driver,
				"test_dl_class",
			),
		).toBe(RETRY);
	});
});

describe("the menu target disposes its failed selector", () => {
	const driver = `
int test_menu_class(void) {
	// menu_api_target would build the class itself, so set the IMP and drive the builder directly.
	menu_imp = (void *)3;
	fail_add_at = 1;
	if (menu_make_target() != 0) return -1;
	if (dispose_calls != 1 || allocate_calls != 1) return -2;
	if (!menu_make_target()) return -3;
	return ${RETRY};
}
`;
	test("menu_make_target disposes and the retry rebuilds the target", () => {
		// The menu unit owns objects through the audit wrappers, so inject their prelude too.
		expect(
			probeWith(
				auditSource(STUB_CLASS_NAMED),
				["98_menu_prelude.c"],
				driver,
				"test_menu_class",
			),
		).toBe(RETRY);
	});
});
