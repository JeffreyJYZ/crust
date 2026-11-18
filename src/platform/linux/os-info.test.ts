/**
 * `os.info` and `os.locale` on Linux. The version comes from a real fixture file written by the test,
 * because `/etc/os-release` is a file the distribution writes and the parsing is the claim; the
 * locale comes from a fake GLib through the shim, because no GTK exists on this machine.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { createOsPlugin } from "@/plugins/os";
import { fakeCoreShim } from "./core-fake.ts";
import { OS_RELEASE, bcp47, linuxOsAdapter, parseOsRelease } from "./os-info.ts";

const DIR = mkdtempSync(join(tmpdir(), "crust-os-release-"));

afterAll(() => {
	rmSync(DIR, { recursive: true, force: true });
});

/** A fixture os-release with the fields a distribution actually writes. */
function fixture(name: string, body: string): string {
	const path = join(DIR, name);
	writeFileSync(path, body);
	return path;
}

const UBUNTU = fixture(
	"ubuntu",
	[
		'NAME="Ubuntu"',
		'VERSION="24.04.3 LTS (Noble Numbat)"',
		'VERSION_ID="24.04"',
		'PRETTY_NAME="Ubuntu 24.04.3 LTS"',
		"ID=ubuntu",
	].join("\n"),
);

const UNQUOTED = fixture("unquoted", ["NAME=Alpine", "VERSION_ID=3.20.3"].join("\n"));

describe("reading /etc/os-release", () => {
	test("VERSION_ID wins, because it is the machine-comparable field", () => {
		expect(parseOsRelease(readFileSync(UBUNTU, "utf8"))).toBe("24.04");
	});

	test("PRETTY_NAME is the fallback when a distribution omits VERSION_ID", () => {
		const text = 'PRETTY_NAME="Some Linux 1"\nID=some\n';
		expect(parseOsRelease(text)).toBe("Some Linux 1");
	});

	test("an unquoted value keeps its own text", () => {
		expect(parseOsRelease(readFileSync(UNQUOTED, "utf8"))).toBe("3.20.3");
	});

	test("a file with neither field answers undefined rather than an empty string", () => {
		expect(parseOsRelease("ID=linux\n")).toBeUndefined();
	});

	test("the documented path is the one read", () => {
		expect(OS_RELEASE).toBe("/etc/os-release");
	});
});

describe("the language name as a BCP-47 tag", () => {
	test("drops the codeset and the modifier, and hyphenates the region", () => {
		expect(bcp47("en_GB.UTF-8")).toBe("en-GB");
		expect(bcp47("de_DE.UTF-8@euro")).toBe("de-DE");
	});

	test("a bare language is left alone", () => {
		expect(bcp47("C")).toBe("C");
	});
});

describe("os.info's native half on Linux", () => {
	test("the version is the fixture's VERSION_ID", () => {
		expect(linuxOsAdapter(() => fakeCoreShim(), UBUNTU).systemVersion()).toBe("24.04");
	});

	test("an unreadable file falls back to the kernel's own release, never a guess", () => {
		const adapter = linuxOsAdapter(() => fakeCoreShim(), join(DIR, "absent"));
		expect(adapter.systemVersion()).toBe(release());
	});

	test("the locale is the first language name, normalised", () => {
		expect(linuxOsAdapter(() => fakeCoreShim({ locale: "en_GB.UTF-8" }), UBUNTU).locale()).toBe(
			"en-GB",
		);
	});

	test("a GLib without the language list is refused by name", () => {
		const adapter = linuxOsAdapter(() => fakeCoreShim({ localeReady: 0 }), UBUNTU);
		expect(() => adapter.locale()).toThrow("g_get_language_names");
	});

	test("an empty language list is a failure, not the empty string", () => {
		const adapter = linuxOsAdapter(() => fakeCoreShim({ locale: "" }), UBUNTU);
		expect(() => adapter.locale()).toThrow("g_get_language_names");
	});

	test("there is no bundle, so no app version is invented", () => {
		expect(linuxOsAdapter(() => fakeCoreShim(), UBUNTU).appVersion()).toBeNull();
	});

	test("uptime is the kernel's, and it is a real number", () => {
		expect(linuxOsAdapter(() => fakeCoreShim(), UBUNTU).uptime()).toBeGreaterThan(0);
	});
});

describe("through the plugin, which is what a page sees", () => {
	test("info answers the version and a null app version", async () => {
		const answer = await createOsPlugin(
			linuxOsAdapter(() => fakeCoreShim(), UBUNTU),
		).commands.info();
		expect(answer).toMatchObject({ ok: true, version: "24.04", appVersion: null });
	});

	test("locale answers the tag", async () => {
		const answer = await createOsPlugin(
			linuxOsAdapter(() => fakeCoreShim({ locale: "fr_FR.UTF-8" }), UBUNTU),
		).commands.locale();
		expect(answer).toEqual({ ok: true, locale: "fr-FR" });
	});

	test("a missing GLib locale is a handler-error naming the call, never NSLocale", async () => {
		const plugin = createOsPlugin(
			linuxOsAdapter(() => fakeCoreShim({ localeReady: 0 }), UBUNTU),
		);
		const answer = await plugin.commands.locale();
		expect(answer).toMatchObject({ ok: false, code: "handler-error" });
		const message = "message" in answer ? answer.message : "";
		expect(message).toContain("g_get_language_names");
		expect(message).not.toContain("NSLocale");
	});
});
