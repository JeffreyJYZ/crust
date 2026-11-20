/**
 * Page-called app commands are granted by the command they name, not by the wire key `app.invoke`.
 *
 * `app.command("notes.save", …)` reaches the page through `app.invoke({ name: "notes.save" })`, so
 * the capability gate must see `app:notes.save`. A grant for another command must not silently
 * become a grant for all of them just because they share one wire handler.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { APP_NAMESPACE } from "@/app-types.ts";
import type { SecurityConfig } from "../../config/types.ts";
import { definePlugin } from "../../plugins/define";
import { headers, invoke, readJson, start, stopAll } from "./fixtures.ts";

afterEach(stopAll);

/** Stand-in for the real app namespace: `invoke` dispatches on `name`, exactly as the real one does. */
const appCommands = definePlugin({
	name: APP_NAMESPACE,
	commands: {
		invoke: (args: unknown) => `did:${(args as { name: string }).name}`,
	},
});

function secured(actions: string[]): Parameters<typeof start>[0] {
	const capabilities: NonNullable<SecurityConfig["capabilities"]> = [{ name: "grant", actions }];
	return {
		handlers: [appCommands],
		security: { capabilities, grants: { main: ["grant"] } },
	};
}

function call(bridge: ReturnType<typeof start>, name: string) {
	return invoke(bridge, headers(bridge, { authorization: `Bearer ${bridge.token}` }), {
		plugin: APP_NAMESPACE,
		command: "invoke",
		args: { name, args: {} },
		window: "main",
	});
}

describe("app command grants", () => {
	test("an exact app:notes.save grant allows save but refuses delete by name", async () => {
		const bridge = start(secured(["app:notes.save"]));

		const saved = await call(bridge, "notes.save");
		expect(saved.status).toBe(200);
		expect((await readJson(saved)).result).toBe("did:notes.save");

		const deleted = await call(bridge, "notes.delete");
		expect(deleted.status).toBe(403);
		const body = await readJson(deleted);
		expect(body.error.code).toBe("forbidden");
		expect(body.error.message).toContain("app:notes.delete");
	});

	test("a wildcard app:notes.* grant covers both commands under that prefix", async () => {
		// `*` is the one metacharacter and matches `delete` as well as `save`. Scoping one command
		// needs an exact action, which is what the test above asserts.
		const bridge = start(secured(["app:notes.*"]));
		expect((await call(bridge, "notes.save")).status).toBe(200);
		expect((await call(bridge, "notes.delete")).status).toBe(200);
	});

	test("a missing name still checks the flat app:invoke action", async () => {
		// A payload with no `name` cannot be refined, so it falls back to the wire key. A narrow
		// grant does not cover it, and a legacy flat grant does — but the handler refuses the shape.
		const narrow = start(secured(["app:notes.save"]));
		const missing = await invoke(
			narrow,
			headers(narrow, { authorization: `Bearer ${narrow.token}` }),
			{
				plugin: APP_NAMESPACE,
				command: "invoke",
				args: {},
				window: "main",
			},
		);
		expect(missing.status).toBe(403);
		expect((await readJson(missing)).error.message).toContain("app:invoke");
	});

	test("the legacy flat app:invoke grant still reaches every app command", async () => {
		// The scaffolds grant `app:greet`; keeping the wire key as a second candidate means
		// per-command scoping does not break an app that opted into the flat grant earlier.
		const bridge = start(secured(["app:invoke"]));
		expect((await call(bridge, "notes.save")).status).toBe(200);
		expect((await call(bridge, "notes.delete")).status).toBe(200);
	});
});
