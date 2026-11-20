/**
 * One builder per source, asserted field by field. These are the brief's source fields, and they are
 * the whole point of the format: a reader can answer "why did this invoke fail" from the record
 * rather than from a print statement.
 */

import { describe, expect, test } from "bun:test";

import {
	appRecord,
	invokeRecord,
	pageRecord,
	platformRecord,
	refuseRecord,
	windowRecord,
} from "@/logging/records";

describe("bridge.invoke", () => {
	test("a success carries a numeric duration, ok and both byte counts", () => {
		const record = invokeRecord({
			window: "main",
			ns: "fs",
			cmd: "read",
			durMs: 1.25,
			ok: true,
			bytesIn: 40,
			bytesOut: 120,
		});
		expect(record.source).toBe("bridge");
		expect(record.event).toBe("bridge.invoke");
		expect(record.fields).toMatchObject({
			window: "main",
			ns: "fs",
			cmd: "read",
			durMs: 1.25,
			ok: true,
			bytesIn: 40,
			bytesOut: 120,
		});
		expect(typeof (record.fields as { durMs: unknown }).durMs).toBe("number");
	});

	test("a failure carries its code and is a warning", () => {
		const record = invokeRecord({
			ns: "fs",
			cmd: "read",
			durMs: 0.5,
			ok: false,
			code: "forbidden",
			bytesIn: 10,
		});
		expect(record.level).toBe("warn");
		expect(record.fields).toMatchObject({ ok: false, code: "forbidden" });
		expect(record.msg).toContain("forbidden");
	});
});

describe("bridge.refuse", () => {
	test("a capability refusal is a warning naming the reason and the command", () => {
		const record = refuseRecord({
			reason: "capability",
			window: "main",
			ns: "fs",
			cmd: "read",
			detail: "fs:read",
		});
		expect(record.event).toBe("bridge.refuse");
		expect(record.level).toBe("warn");
		expect(record.fields).toMatchObject({
			reason: "capability",
			window: "main",
			ns: "fs",
			cmd: "read",
		});
	});

	test("a token refusal is debug, so pre-auth noise stays out of an info-level build", () => {
		expect(refuseRecord({ reason: "token" }).level).toBe("debug");
		expect(refuseRecord({ reason: "origin" }).level).toBe("debug");
	});
});

describe("window events", () => {
	test("create carries label, frame and visibility", () => {
		const record = windowRecord({
			event: "create",
			label: "main",
			width: 900,
			height: 600,
			visible: true,
		});
		expect(record.source).toBe("window");
		expect(record.event).toBe("window.create");
		expect(record.fields).toMatchObject({
			label: "main",
			width: 900,
			height: 600,
			visible: true,
		});
	});

	test("close and resize are their own dotted events", () => {
		expect(windowRecord({ event: "close", label: "main", visible: false }).event).toBe(
			"window.close",
		);
		expect(windowRecord({ event: "resize", label: "main", width: 10, height: 20 }).event).toBe(
			"window.resize",
		);
	});
});

describe("app events", () => {
	test("a summary is counts, and the level can be raised for a debug-only line", () => {
		const info = appRecord("app.start", "starting", { windows: 1, capabilities: 2 });
		expect(info.source).toBe("app");
		expect(info.level).toBe("info");
		expect(info.fields).toEqual({ windows: 1, capabilities: 2 });
		expect(appRecord("app.command.registered", "x", {}, "debug").level).toBe("debug");
	});
});

describe("page events", () => {
	test("a console line maps its own level onto the five, keeping the original", () => {
		const record = pageRecord(
			{ kind: "console", level: "warn", args: ["careful", 42], url: "http://h/" },
			"main",
		);
		expect(record.source).toBe("page");
		expect(record.event).toBe("page.console");
		expect(record.level).toBe("warn");
		expect(record.fields).toMatchObject({ consoleLevel: "warn", window: "main" });
	});

	test("an uncaught error is an error with message, stack, url, line and col", () => {
		const record = pageRecord(
			{
				kind: "error",
				message: "boom",
				stack: "Error: boom\n  at a\n  at b",
				url: "http://h/app.js",
				line: 12,
				col: 3,
			},
			"main",
		);
		expect(record.event).toBe("page.error");
		expect(record.level).toBe("error");
		expect(record.fields).toMatchObject({
			message: "boom",
			url: "http://h/app.js",
			line: 12,
			col: 3,
		});
	});
});

describe("platform refusals", () => {
	test("carry the api that refused, its code and its detail", () => {
		const record = platformRecord({
			api: "NSScreen screens",
			code: "not-implemented",
			detail: "crust: screen needs NSScreen screens",
		});
		expect(record.source).toBe("platform");
		expect(record.event).toBe("platform.refuse");
		expect(record.level).toBe("error");
		expect(record.fields).toMatchObject({
			api: "NSScreen screens",
			code: "not-implemented",
		});
	});
});
