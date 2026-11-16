/**
 * Server-side bridge proofs: the token gate, the origin gate, and what an invoke answers. Every rejection rule is one `research/bridge.md` measured, and each test states the measured answer it holds.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { headers, invoke, PNG, readJson, SECRET, start, stopAll } from "./server/fixtures.ts";

afterEach(stopAll);

describe("token gate", () => {
	test("missing token answers 401 unauthorized", async () => {
		const bridge = start();
		const response = await invoke(bridge, headers(bridge));
		expect(response.status).toBe(401);
		const body = await readJson(response);
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe("unauthorized");
	});

	test("wrong token answers 401 with the same body as no token", async () => {
		const bridge = start();
		const response = await invoke(bridge, headers(bridge, { authorization: "Bearer wrong" }));
		expect(response.status).toBe(401);
		const body = await readJson(response);
		expect(body.error.code).toBe("unauthorized");
	});

	test("a plugin command cannot be reached without a token", async () => {
		const bridge = start();
		const response = await invoke(bridge, headers(bridge), {
			plugin: "test",
			command: "secret",
			args: {},
		});
		expect(response.status).toBe(401);
		expect(await response.text()).not.toContain(SECRET);
	});
});

describe("origin gate", () => {
	test("own origin with the right token answers 200", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
		);
		expect(response.status).toBe(200);
		const body = await readJson(response);
		expect(body.ok).toBe(true);
		expect(body.result).toEqual({ hello: "world" });
	});

	test("an absent Origin with the right token is allowed: the token is the credential", async () => {
		const bridge = start();
		const response = await invoke(bridge, {
			"content-type": "application/json",
			authorization: `Bearer ${bridge.token}`,
		});
		expect(response.status).toBe(200);
		const body = await readJson(response);
		expect(body.result).toEqual({ hello: "world" });
	});

	test("an absent Origin without a token is still refused 401", async () => {
		const bridge = start();
		const response = await invoke(bridge, { "content-type": "application/json" });
		expect(response.status).toBe(401);
		const body = await readJson(response);
		expect(body.error.code).toBe("unauthorized");
	});

	test("a foreign origin is refused 403", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, {
				authorization: `Bearer ${bridge.token}`,
				origin: "http://127.0.0.2:1",
			}),
		);
		expect(response.status).toBe(403);
	});
});

describe("invoke", () => {
	test("round-trips a plugin command and its args", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "echo",
				args: { nested: { n: 7 }, list: [1, 2, 3] },
			},
		);
		const body = await readJson(response);
		expect(body.result).toEqual({ nested: { n: 7 }, list: [1, 2, 3] });
	});

	test("an unknown command is a structured 404", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "nope",
			},
		);
		expect(response.status).toBe(404);
		const body = await readJson(response);
		expect(body.error.code).toBe("unknown-command");
	});

	test("a throwing handler is a structured handler-error", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "boom",
			},
		);
		expect(response.status).toBe(500);
		const body = await readJson(response);
		expect(body.error.code).toBe("handler-error");
		expect(body.error.message).toBe("handler blew up");
	});
});

describe("binary results", () => {
	test("bytes one level inside an object arrive tagged and decode to the same bytes", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{ plugin: "test", command: "png" },
		);
		const body = await readJson(response);
		expect(body.result.ok).toBe(true);
		expect(typeof body.result.png.__crustBytes).toBe("string");
		expect(new Uint8Array(Buffer.from(body.result.png.__crustBytes, "base64"))).toEqual(PNG);
	});

	test("bytes as the whole result are tagged too", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{ plugin: "test", command: "pngBare" },
		);
		const body = await readJson(response);
		expect(new Uint8Array(Buffer.from(body.result.__crustBytes, "base64"))).toEqual(PNG);
	});

	test("a text result is the same json bytes it always was", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
		);
		expect(await response.text()).toBe('{"ok":true,"result":{"hello":"world"}}');
	});
});
