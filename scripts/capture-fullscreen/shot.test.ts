/** The line the gate is read from: a missing picture and a 1x1 image must never read as success. */
import { expect, test } from "bun:test";
import { type Shot, code, line } from "./shot.ts";

const base: Shot = {
	ms: 12,
	answer: "ok",
	picture: "real",
	width: 480,
	height: 320,
	scale: 2,
	bytes: 9000,
	measured: {
		width: 480,
		height: 320,
		pixels: 153600,
		opaque: 153600,
		colours: 4,
		differing: 153599,
	},
};

test("a real picture carries every measured number", () => {
	const text = line("ignoreOcclusion=true", base);
	expect(text).toContain("real");
	for (const field of [
		"w=480",
		"h=320",
		"scale=2",
		"bytes=9000",
		"pixels=153600",
		"opaque=153600",
		"colours=4",
		"differing=153599",
	])
		expect(text).toContain(field);
});

test("no png and a 1x1 image are named, not counted as a pass", () => {
	const none = line("ignoreOcclusion=false", {
		...base,
		answer: "no-completion",
		picture: "no-png",
		width: 0,
		height: 0,
		scale: 0,
		bytes: 0,
		measured: undefined,
	});
	expect(none).toContain("no-png w=0 h=0");
	expect(none).toContain("bytes=0 pixels=0");
	expect(none).not.toContain(" real ");
	const tiny = line("ignoreOcclusion=true", {
		...base,
		picture: "1x1",
		width: 1,
		height: 1,
		bytes: 90,
		measured: { width: 1, height: 1, pixels: 1, opaque: 1, colours: 1, differing: 0 },
	});
	expect(tiny).toContain("1x1 w=1 h=1");
	expect(tiny).toContain("pixels=1");
	expect(tiny).toContain("differing=0");
});

test("long named statuses become short gate codes", () => {
	expect(
		code("crust: window.capture: WebKit never called the snapshot completion handler: ..."),
	).toBe("no-completion");
	expect(code("crust: window.capture ignoreOcclusion: unsupported WebKit ...")).toBe(
		"spi-absent",
	);
});
