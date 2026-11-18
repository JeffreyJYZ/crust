/**
 * The capability model, asserted through the real bridge: the compatibility guarantee, deny by
 * default, per-label grants, and each matcher rule the brief names.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { compileCapabilities } from "./server/capabilities.ts";
import {
	headers,
	invoke,
	ownOrigin,
	readJson,
	start,
	stopAll,
	testPlugin,
} from "./server/fixtures.ts";
import type { SecurityConfig } from "../config/types.ts";

afterEach(stopAll);

const CAPABILITIES: NonNullable<SecurityConfig["capabilities"]> = [
	{ name: "fs-read", actions: ["fs:read*"] },
	{ name: "shell", actions: ["shell:spawn"] },
	{ name: "panels", actions: ["dialog:*"] },
];

function withSecurity(security: SecurityConfig): Parameters<typeof start>[0] {
	return { handlers: [testPlugin], security };
}

describe("no capabilities configured", () => {
	test("every command is allowed, which is what every existing app sees", async () => {
		const bridge = start();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "echo",
				args: "hello",
				window: "whatever",
			},
		);
		expect(response.status).toBe(200);
		expect((await readJson(response)).result).toBe("hello");
	});

	test("an absent security section is open", () => {
		expect(compileCapabilities(undefined).open).toBe(true);
	});

	test("an empty capability list is open too, so opting in with no grants breaks nothing", () => {
		expect(compileCapabilities({ capabilities: [] }).open).toBe(true);
	});
});

describe("present capabilities deny by default", () => {
	test("an unlisted command is a 403 forbidden naming the action", async () => {
		const bridge = start(
			withSecurity({ capabilities: CAPABILITIES, grants: { main: ["panels"] } }),
		);
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "secret",
				window: "main",
			},
		);
		expect(response.status).toBe(403);
		const body = await readJson(response);
		expect(body.error.code).toBe("forbidden");
		expect(body.error.message).toContain("test:secret");
		expect(body.error.message).toContain("main");
	});

	test("a label with no entry in grants holds nothing", async () => {
		const bridge = start(
			withSecurity({ capabilities: CAPABILITIES, grants: { main: ["panels"] } }),
		);
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${bridge.token}` }),
			{
				plugin: "test",
				command: "echo",
				args: 1,
				window: "other",
			},
		);
		expect(response.status).toBe(403);
		expect((await readJson(response)).error.code).toBe("forbidden");
	});

	test("a label-less document holds only the default label's grants", async () => {
		const bridge = start(
			withSecurity({ capabilities: CAPABILITIES, grants: { admin: ["panels"] } }),
		);
		// With no `?window=` the document route binds the token to the default label `main`, which
		// holds nothing here. The body claiming `admin` must not become authority — it only routes.
		const served = await fetch(`${bridge.url}/?token=${bridge.token}`, { redirect: "manual" });
		const location = served.headers.get("location");
		if (location === null) throw new Error("the document route did not mint a token");
		const documentToken = new URL(location, bridge.url).searchParams.get("token");
		expect(documentToken).not.toBeNull();
		const response = await invoke(
			bridge,
			headers(bridge, { authorization: `Bearer ${documentToken}` }),
			{ plugin: "test", command: "echo", args: 1, window: "admin" },
		);
		expect(response.status).toBe(403);
		expect((await readJson(response)).error.message).toContain('window "main"');
	});

	test("a granted label reaches one plugin and is refused another", async () => {
		const bridge = start(
			withSecurity({ capabilities: CAPABILITIES, grants: { main: ["fs-read"] } }),
		);
		const requestHeaders = headers(bridge, { authorization: `Bearer ${bridge.token}` });
		// `fs.readTextFile` is covered by `fs:read*`, so the gate lets it through and the handler's
		// own answer (a 404 for a missing file) is what comes back — never a `forbidden`.
		const read = await invoke(bridge, requestHeaders, {
			plugin: "fs",
			command: "readTextFile",
			args: { path: "/definitely/missing" },
			window: "main",
		});
		expect(read.status).not.toBe(403);

		// `test.secret` exists and nothing grants it, so it is refused by the gate.
		const secret = await invoke(bridge, requestHeaders, {
			plugin: "test",
			command: "secret",
			window: "main",
		});
		expect(secret.status).toBe(403);
		expect((await readJson(secret)).error.code).toBe("forbidden");
	});

	test("the binary payload path is gated by the same check", async () => {
		const bridge = start(
			withSecurity({ capabilities: CAPABILITIES, grants: { main: ["panels"] } }),
		);
		const response = await fetch(
			`${bridge.url}/_crust/invoke?plugin=test&command=measureBytes`,
			{
				method: "POST",
				headers: {
					origin: ownOrigin(bridge),
					authorization: `Bearer ${bridge.token}`,
					"content-type": "application/octet-stream",
				},
				body: new Uint8Array([1, 2, 3]),
			},
		);
		expect(response.status).toBe(403);
		expect((await readJson(response)).error.code).toBe("forbidden");
	});
});
