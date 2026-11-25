/**
 * hunt-22/19-security F1 and F2, exercised through a real bridge.
 *
 * A page whose document token is bound to `worker` and whose only grant is `window:create`
 * used to mint a `main`-authority document by naming a bridge-owned absolute URL. A `//host`
 * path then put that minted token in a protocol-relative Location, handing it to a foreign
 * origin. Both tests here drive the bridge and the window plugin, not a helper in isolation.
 */
import { afterEach, expect, test } from "bun:test";
import { request as httpRequest } from "node:http";
import type { SecurityConfig } from "../config/types.ts";
import { fakeAdapter } from "@/plugins/window-fake.ts";
import { createWindowPlugin } from "@/plugins/window.ts";
import { setBridgeToken } from "./window-identity.ts";
import {
	headers,
	invoke,
	ownOrigin,
	readJson,
	start,
	stopAll,
	testPlugin,
} from "./server/fixtures.ts";

const SECURITY: SecurityConfig = {
	capabilities: [
		{ name: "create", actions: ["window:create"] },
		{ name: "echo", actions: ["test:echo"] },
	],
	grants: { worker: ["create"], main: ["echo"] },
};

/**
 * A path-as-is GET. `fetch` folds `//host` into `/host` before it goes on the wire, which is why a
 * browser-level probe misses the protocol-relative redirect; the native WebView sends the URL string
 * byte-exact, so this client does too.
 */
function rawGet(port: number, path: string): Promise<{ status: number; location?: string }> {
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			{ hostname: "127.0.0.1", port, path, method: "GET" },
			(response) => {
				resolve({
					status: response.statusCode ?? 0,
					location: response.headers.location as string | undefined,
				});
				response.resume();
			},
		);
		request.on("error", reject);
		request.end();
	});
}

/** A document token bound to `label`, minted the way a window navigation mints one. */
async function documentToken(bridge: { url: string; token: string }, label: string) {
	const served = await fetch(
		`${bridge.url}/?token=${bridge.token}&window=${encodeURIComponent(label)}`,
		{ redirect: "manual" },
	);
	if (served.status !== 302) throw new Error(`expected a mint, got ${served.status}`);
	const location = served.headers.get("location");
	if (location === null) throw new Error("the mint carried no Location");
	const token = new URL(location, bridge.url).searchParams.get("token");
	if (token === null) throw new Error("the mint carried no token");
	return token;
}

afterEach(async () => {
	setBridgeToken(undefined);
	await stopAll();
});

test("a worker's bridge-owned create cannot reach main's grants", async () => {
	const adapter = fakeAdapter(["main"]);
	const bridge = start({
		handlers: [testPlugin, createWindowPlugin(adapter)],
		indexHtml: "<html></html>",
		security: SECURITY,
	});
	setBridgeToken(bridge.token, bridge.url);
	const worker = await documentToken(bridge, "worker");

	const created = await invoke(bridge, headers(bridge, { authorization: `Bearer ${worker}` }), {
		plugin: "window",
		command: "create",
		args: { label: "child", url: `${ownOrigin(bridge)}/x` },
	});
	expect(created.status).toBe(200);

	const call = adapter.calls.find((entry) => entry.startsWith("create:child:"));
	if (call === undefined) throw new Error("no window was created");
	const childUrl = call.slice(call.indexOf(":-x-:-:") + ":-x-:-:".length);
	const served = await fetch(childUrl, { redirect: "manual" });
	expect(served.status).toBe(302);
	const location = served.headers.get("location");
	if (location === null) throw new Error("the child document carried no Location");
	const childToken = new URL(location, bridge.url).searchParams.get("token");
	if (childToken === null) throw new Error("the child document carried no token");

	// `test:echo` belongs to main alone. A token minted by a worker's create must not carry it.
	const echo = await invoke(bridge, headers(bridge, { authorization: `Bearer ${childToken}` }), {
		plugin: "test",
		command: "echo",
		args: 1,
	});
	expect(echo.status).toBe(403);
});

test("the document route never sends a minted token to a protocol-relative host", async () => {
	const bridge = start({ handlers: [testPlugin], indexHtml: "<html></html>" });
	const served = await rawGet(bridge.port, `//evil.example/x?token=${bridge.token}`);
	expect(served.status).toBe(302);
	const location = served.location ?? "";
	expect(new URL(location, bridge.url).origin).toBe(ownOrigin(bridge));
});

test("window.create refuses a bridge URL with an authority-absolute path", async () => {
	const adapter = fakeAdapter(["main"]);
	const bridge = start({
		handlers: [testPlugin, createWindowPlugin(adapter)],
		indexHtml: "<html></html>",
		security: SECURITY,
	});
	setBridgeToken(bridge.token, bridge.url);
	const worker = await documentToken(bridge, "worker");

	const created = await invoke(bridge, headers(bridge, { authorization: `Bearer ${worker}` }), {
		plugin: "window",
		command: "create",
		args: { label: "child", url: `${ownOrigin(bridge)}//evil.example/x` },
	});
	expect((await readJson(created)).result).toMatchObject({
		ok: false,
		code: "invalid-url",
	});
	expect(adapter.calls.filter((entry) => entry.startsWith("create:"))).toEqual([]);
});
