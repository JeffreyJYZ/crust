/**
 * A command name is wire data. The registry must answer `unknown-command` for every name that is
 * not an own key — including inherited `Object.prototype` members — without refusing an app that
 * deliberately registers a command under one of those names.
 */
import { describe, expect, test } from "bun:test";
import { definePlugin } from "./define";
import { PluginRegistry } from "./registry";

const DANGEROUS = [
	"__proto__",
	"constructor",
	"toString",
	"valueOf",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
];
const ctx = { emit: () => {} };

describe("registry command-name lookup", () => {
	test("every inherited Object.prototype name is an unknown command", async () => {
		const registry = new PluginRegistry().register(
			definePlugin({ name: "keys", commands: { ping: () => "pong" } }),
		);
		for (const name of DANGEROUS) {
			await expect(registry.invoke("keys", name, {}, ctx)).rejects.toMatchObject({
				code: "unknown-command",
				message: expect.stringContaining(name),
			});
		}
	});

	test("an own command under a dangerous name still runs", async () => {
		const registry = new PluginRegistry().register(
			definePlugin({ name: "own", commands: { ["__proto__"]: () => "own-key" } }),
		);
		expect(await registry.invoke("own", "__proto__", {}, ctx)).toBe("own-key");
	});
});
