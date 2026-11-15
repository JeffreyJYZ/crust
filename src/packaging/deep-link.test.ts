/**
 * The deep-link packaging proofs: a scheme table, the `CFBundleURLTypes` row, and the merge that puts it inside the plist rather than after it. No bundle is built here — `infoPlist` is pure text, so the merge is checkable as a string.
 */

import { describe, expect, test } from "bun:test";
import { infoPlist } from "./plist.ts";
import {
	deepLinkPlistEntry,
	deepLinkPlistFragment,
	mergeDeepLinkPlist,
	RESERVED_SCHEMES,
	validateScheme,
} from "./deep-link.ts";

const VALID = ["crust", "my-app", "a", "my+app.1.0", "web+crust", "x1"];

const INVALID = ["", "Crust", "1abc", "-abc", "my app", "my_scheme", "my:scheme", "ht/tp"];

describe("scheme validation", () => {
	for (const scheme of VALID) {
		test(`accepts ${scheme}`, () => {
			expect(validateScheme(scheme)).toBe(scheme);
		});
	}

	for (const scheme of INVALID) {
		test(`refuses ${JSON.stringify(scheme)}`, () => {
			expect(() => validateScheme(scheme)).toThrow(/deep-link scheme/);
		});
	}

	for (const scheme of RESERVED_SCHEMES) {
		test(`refuses the reserved ${scheme}`, () => {
			expect(() => validateScheme(scheme)).toThrow(/reserved/);
		});
	}

	test("refuses a reserved scheme in any case, before the pattern complains", () => {
		expect(() => validateScheme("HTTPS")).toThrow(/reserved/);
	});

	test("refuses a non-string", () => {
		expect(() => validateScheme(undefined)).toThrow(/non-empty string/);
		expect(() => validateScheme(42)).toThrow(/non-empty string/);
	});
});

describe("plist entry", () => {
	test("names the scheme by default and carries it as the one scheme", () => {
		expect(deepLinkPlistEntry("crust")).toEqual({
			CFBundleURLName: "crust",
			CFBundleURLSchemes: ["crust"],
		});
	});

	test("takes the bundle identifier as the URL name", () => {
		expect(deepLinkPlistEntry("crust", { name: "land.jyz.example" })).toEqual({
			CFBundleURLName: "land.jyz.example",
			CFBundleURLSchemes: ["crust"],
		});
	});

	test("validates, so a reserved scheme cannot reach a plist", () => {
		expect(() => deepLinkPlistEntry("http")).toThrow(/reserved/);
	});

	test("escapes XML in the name", () => {
		const fragment = deepLinkPlistFragment(deepLinkPlistEntry("crust", { name: "a&b" }));
		expect(fragment).toContain("<string>a&amp;b</string>");
		expect(fragment).not.toContain("a&b");
	});
});

describe("plist fragment and merge", () => {
	const entry = deepLinkPlistEntry("crust", { name: "land.jyz.example" });

	test("the fragment is a top-level key, one array, one dict", () => {
		const fragment = deepLinkPlistFragment(entry);
		expect(fragment.startsWith("\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n")).toBe(
			true,
		);
		expect(fragment.match(/<dict>/g)?.length).toBe(1);
		expect(fragment).toContain("<key>CFBundleURLSchemes</key>");
		expect(fragment).toContain("<string>crust</string>");
		expect(fragment.endsWith("\t</array>\n")).toBe(true);
	});

	test("merges inside the closing dict, not after </plist>", () => {
		const plist = infoPlist({
			executableName: "example",
			name: "Example",
			id: "land.jyz.example",
			version: "0.1.0",
			minimumSystemVersion: "13.0",
			hasIcon: false,
		});
		const merged = mergeDeepLinkPlist(plist, entry);
		expect(merged).toContain("<key>CFBundleURLTypes</key>");
		// The last `</dict>` is the top-level one; the ATS dict closes earlier.
		expect(merged.indexOf("<key>CFBundleURLTypes</key>")).toBeLessThan(
			merged.lastIndexOf("</dict>"),
		);
		expect(merged.match(/<\/plist>/g)?.length).toBe(1);
		expect(merged.endsWith("</plist>\n")).toBe(true);
		// Nothing else moved: the merge is an insertion, not a rewrite.
		expect(merged.replace(deepLinkPlistFragment(entry), "")).toBe(plist);
	});

	test("merges beside the icon key when the bundle has one", () => {
		const plist = infoPlist({
			executableName: "example",
			name: "Example",
			id: "land.jyz.example",
			version: "0.1.0",
			minimumSystemVersion: "13.0",
			hasIcon: true,
		});
		const merged = mergeDeepLinkPlist(plist, entry);
		expect(merged).toContain("<string>icon.icns</string>");
		expect(merged.indexOf("<key>CFBundleIconFile</key>")).toBeLessThan(
			merged.indexOf("<key>CFBundleURLTypes</key>"),
		);
	});

	test("refuses a plist it cannot place the key in", () => {
		expect(() => mergeDeepLinkPlist("<plist></plist>", entry)).toThrow(/no closing <\/dict>/);
	});
});
