/**
 * Capability authority is bound to the credential, not to a request field.
 *
 * `window-identity.ts` says a label is a routing hint, never authority. Until now the capability
 * gate read that same hint as its sole authority, so a page holding the one process token could
 * claim any label. The document route now mints a token per document and binds it to the label it
 * observed; the invoke gate reads that bound label and leaves the body's label for routing only.
 */

import { afterEach, describe, expect, test } from "bun:test";

import type { SecurityConfig } from "../config/types.ts";
import { createWindowPlugin } from "@/plugins/window.ts";
import { fakeAdapter } from "@/plugins/window-fake.ts";
import { headers, invoke, readJson, start, stopAll, testPlugin } from "./server/fixtures.ts";
import type { BridgeHandle, StartBridgeOptions } from "./server.ts";

afterEach(stopAll);

const CAPABILITIES: NonNullable<SecurityConfig["capabilities"]> = [
	{ name: "safe", actions: ["test:echo"] },
	{ name: "secret", actions: ["test:secret"] },
];

function secured(): StartBridgeOptions {
	return {
		handlers: [testPlugin],
		security: {
			capabilities: CAPABILITIES,
			grants: { main: ["safe"], admin: ["secret"] },
		},
	};
}

/** Mint a document token for `label` the way `windowUrl` navigates a window. */
async function documentToken(bridge: BridgeHandle, label?: string): Promise<string> {
	const search =
		label === undefined
			? `token=${bridge.token}`
			: `token=${bridge.token}&window=${encodeURIComponent(label)}`;
	const served = await fetch(`${bridge.url}/?${search}`, { redirect: "manual" });
	expect(served.status).toBe(302);
	const location = served.headers.get("location");
	if (location === null) throw new Error("the document route did not mint a token");
	const token = new URL(location, bridge.url).searchParams.get("token");
	if (token === null) throw new Error("the minted document carried no token");
	return token;
}

async function call(bridge: BridgeHandle, token: string, body: Record<string, unknown>) {
	return await invoke(bridge, headers(bridge, { authorization: `Bearer ${token}` }), body);
}

describe("the credential decides authority", () => {
	test("the process token cannot claim another label's grant", async () => {
		const bridge = start(secured());
		const echo = await call(bridge, bridge.token, {
			plugin: "test",
			command: "echo",
			args: 1,
			window: "main",
		});
		expect(echo.status).toBe(200);
		const spoof = await call(bridge, bridge.token, {
			plugin: "test",
			command: "secret",
			window: "admin",
		});
		expect(spoof.status).toBe(403);
		expect((await readJson(spoof)).error.code).toBe("forbidden");
	});

	test("a second window's document gets only its own grants", async () => {
		const bridge = start(secured());
		const mainToken = await documentToken(bridge, "main");
		const adminToken = await documentToken(bridge, "admin");

		// The main token cannot reach the admin command even when the body claims `admin`.
		const denied = await call(bridge, mainToken, {
			plugin: "test",
			command: "secret",
			window: "admin",
		});
		expect(denied.status).toBe(403);
		expect((await readJson(denied)).error.message).toContain('window "main"');

		// The admin token can reach its own command even when the body says `main`.
		const allowed = await call(bridge, adminToken, {
			plugin: "test",
			command: "secret",
			window: "main",
		});
		expect(allowed.status).toBe(200);
		expect((await readJson(allowed)).result).toContain("SECRET");

		// The admin token does not inherit main's `safe` grant.
		const other = await call(bridge, adminToken, {
			plugin: "test",
			command: "echo",
			args: 1,
			window: "main",
		});
		expect(other.status).toBe(403);
	});

	test("a token the bridge never issued is refused", async () => {
		const bridge = start(secured());
		const response = await call(bridge, crypto.randomUUID(), {
			plugin: "test",
			command: "echo",
			args: 1,
			window: "main",
		});
		expect(response.status).toBe(401);
	});
});

describe("minting is one-way", () => {
	test("a page cannot rebind its own document token to another label", async () => {
		const bridge = start(secured());
		const mainToken = await documentToken(bridge, "main");
		// A page holding its main token tries to fetch an admin document and read the redirect.
		const served = await fetch(`${bridge.url}/?token=${mainToken}&window=admin`, {
			redirect: "manual",
		});
		expect(served.status).toBe(200);
		expect(served.headers.get("location")).toBeNull();
		const denied = await call(bridge, mainToken, {
			plugin: "test",
			command: "secret",
			window: "admin",
		});
		expect(denied.status).toBe(403);
	});

	test("a cross-origin fetch cannot seed a document with a new label", async () => {
		const bridge = start({ ...secured(), devOrigin: "http://localhost:5173" });
		const served = await fetch(`${bridge.url}/?token=${bridge.token}&window=admin`, {
			redirect: "manual",
			headers: { origin: "http://localhost:5173" },
		});
		expect(served.status).toBe(200);
		expect(served.headers.get("location")).toBeNull();
	});
});

describe("the body label still routes", () => {
	test("window.label answers the routing hint, not the bound label", async () => {
		const bridge = start({
			handlers: [createWindowPlugin(fakeAdapter(["main", "inspector"]))],
		});
		const mainToken = await documentToken(bridge, "main");
		const response = await call(bridge, mainToken, {
			plugin: "window",
			command: "label",
			window: "inspector",
		});
		expect(response.status).toBe(200);
		expect((await readJson(response)).result).toEqual({ ok: true, label: "inspector" });
	});
});
