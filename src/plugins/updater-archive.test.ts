import { describe, expect, test } from "bun:test";

import { archiveRoot, isZip, readArchive } from "@/plugins/updater-archive";
import { buildZip, bundleZip } from "@/plugins/updater-zip-fixture";

const encoder = new TextEncoder();

describe("updater's zip reader", () => {
	test("reads a bundle's directories, files and symlink, keeping the executable mode", () => {
		const archive = readArchive(bundleZip());
		expect(archive.root).toBe("Notes.app");
		const byName = new Map(archive.entries.map((entry) => [entry.name, entry]));
		expect(byName.get("Notes.app/Contents/")?.kind).toBe("directory");
		expect(byName.get("Notes.app/Contents/marker.txt")?.kind).toBe("file");
		const marker = byName.get("Notes.app/Contents/marker.txt")?.bytes ?? new Uint8Array();
		expect(new TextDecoder().decode(marker)).toBe("new");
		// The deflated entry proves method 8 inflates, not just that stored bytes copy.
		const executable = byName.get("Notes.app/Contents/MacOS/Notes");
		expect(new TextDecoder().decode(executable?.bytes ?? new Uint8Array())).toBe("#!/bin/sh\n");
		expect(executable?.mode).toBe(0o755);
		expect(byName.get("Notes.app/Contents/Versions/Current")).toMatchObject({
			kind: "symlink",
			target: "A",
		});
	});

	test("only a real zip opens like one", () => {
		expect(isZip(bundleZip())).toBe(true);
		expect(isZip(encoder.encode("bundle-bytes"))).toBe(false);
		expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
	});

	test("a `..` entry is refused by name", () => {
		const bytes = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/marker.txt", body: "new" },
			{ name: "../evil.txt", body: "pwned" },
		]);
		expect(() => readArchive(bytes)).toThrow(/"\.\.\/evil\.txt" that climbs out with "\.\."/);
	});

	test("an absolute entry, a backslash and a nested climb are refused by name", () => {
		const base = [{ name: "Notes.app/", mode: 0o755 }];
		const absolute = buildZip([...base, { name: "/etc/passwd", body: "pwned" }]);
		expect(() => readArchive(absolute)).toThrow(/"\/etc\/passwd" that is an absolute path/);
		const backslash = buildZip([...base, { name: "Notes.app\\..\\evil.txt", body: "pwned" }]);
		expect(() => readArchive(backslash)).toThrow(/containing a backslash/);
		const nested = buildZip([...base, { name: "Notes.app/../../evil.txt", body: "pwned" }]);
		expect(() => readArchive(nested)).toThrow(/"Notes\.app\/\.\.\/\.\.\/evil\.txt"/);
	});

	test("a symlink pointing outside the bundle is refused, one inside it is kept", () => {
		const outside = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/evil", link: "../../../../etc/passwd" },
		]);
		expect(() => readArchive(outside)).toThrow(/"Notes\.app\/Contents\/evil" pointing outside/);
		const absolute = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/evil", link: "/etc/passwd" },
		]);
		expect(() => readArchive(absolute)).toThrow(/pointing at the absolute path/);
		const inside = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Notes.app/Contents/Versions/A/", mode: 0o755 },
			{ name: "Notes.app/Contents/Versions/Current", link: "A" },
		]);
		expect(readArchive(inside).root).toBe("Notes.app");
	});

	test("an update is exactly one top-level .app directory", () => {
		const two = buildZip([
			{ name: "Notes.app/", mode: 0o755 },
			{ name: "Evil.app/", mode: 0o755 },
		]);
		expect(() => readArchive(two)).toThrow(/holds 2 top-level entries/);
		const loose = buildZip([{ name: "Notes/Contents/marker.txt", body: "new" }]);
		expect(() => readArchive(loose)).toThrow(/holds "Notes", which is not a named \.app/);
		const flat = buildZip([{ name: "Notes.app", body: "not a directory" }]);
		expect(archiveRoot(readArchive(flat).entries)).toBe("Notes.app");
	});

	test("bytes that are not a zip are refused, never parsed as one", () => {
		expect(() => readArchive(encoder.encode("bundle-bytes"))).toThrow(
			/is not a zip archive: no end-of-central-directory record/,
		);
	});
});
