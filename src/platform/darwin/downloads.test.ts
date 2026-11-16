/**
 * The destination the delegate hands WebKit, proven without compiling anything: `uniquePath` is the
 * only place a download name is chosen, and it runs on the AppKit thread while the page waits.
 * The race this suite exists for: two downloads that start before either file exists were both told
 * the same name, so the second silently replaced the first. `existsSync` cannot see that, so a
 * process-local reservation has to.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { uniquePath } from "./downloads.ts";

const directory = mkdtempSync(join(tmpdir(), "crust-downloads-unique-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("uniquePath", () => {
	test("names handed out before any file exists are all different", () => {
		const first = uniquePath(directory, "report.zip");
		const second = uniquePath(directory, "report.zip");
		const third = uniquePath(directory, "report.zip");

		expect(new Set([first, second, third]).size).toBe(3);
		expect(basename(first)).toBe("report.zip");
		expect(basename(second)).toBe("report (1).zip");
		expect(basename(third)).toBe("report (2).zip");
	});

	test("a name already on disk is skipped, without a reservation", () => {
		writeFileSync(join(directory, "taken.zip"), "already here");
		const chosen = uniquePath(directory, "taken.zip");
		expect(basename(chosen)).toBe("taken (1).zip");
	});

	test("a suggestion with no extension keeps the counter readable", () => {
		expect(basename(uniquePath(directory, "LICENSE"))).toBe("LICENSE");
		expect(basename(uniquePath(directory, "LICENSE"))).toBe("LICENSE (1)");
	});

	test("an empty suggestion still gets a real name", () => {
		expect(basename(uniquePath(directory, ""))).toBe("download");
	});

	test("a separator in the suggestion can never leave the directory", () => {
		const chosen = uniquePath(directory, "../../etc/passwd");
		expect(chosen.startsWith(directory)).toBe(true);
		expect(basename(chosen)).toBe(".._.._etc_passwd");
	});
});
