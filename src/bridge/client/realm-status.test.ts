/**
 * The content-world transport hands the page a bare object, not an HTTP response. A failed invoke
 * must never tell `ready` that the bridge answered: a string status once coerced into a success,
 * and a transport failure with status 0 once resolved readiness through the 5xx "handler threw"
 * rule. A real 4xx refusal still has to reject `ready`.
 */
import { describe, expect, test } from "bun:test";
import { bootstrapSource } from "../client.ts";

interface TestApi {
	invoke(plugin: string, command: string, args?: unknown): Promise<unknown>;
	ready: Promise<void>;
}

function withRealm(reply: unknown): TestApi {
	const target: Record<string, any> = { crustInvoke: async () => reply };
	const snippet = bootstrapSource({ baseUrl: "http://127.0.0.1:1", token: "t", port: 1 });
	const factory = new Function("window", "location", `return ${snippet};`) as (
		scope: Record<string, any>,
		location: { search: string },
	) => TestApi;
	return factory(target, { search: "" });
}

/** Short on purpose: this asserts the absence of a settlement, not a timeout feature. */
const settled = (ready: Promise<void>) =>
	Promise.race([ready.then(() => "ready", () => "rejected"), Bun.sleep(25).then(() => "pending")]);

describe("content-world invoke and readiness", () => {
	test("a string status cannot coerce into a successful handshake", async () => {
		const api = withRealm({
			ok: false,
			error: { code: "handler-error", status: "200", message: "bad wire status" },
		});
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({ status: 400 });
		await expect(api.ready).rejects.toMatchObject({ code: "bridge-refused", status: 400 });
	});

	test("a status-0 transport failure leaves ready pending", async () => {
		const api = withRealm({ ok: false, error: { code: "no-fetch", status: 0 } });
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({
			code: "no-fetch",
			status: 0,
		});
		expect(await settled(api.ready)).toBe("pending");
	});

	test("a real 4xx refusal still rejects ready with the bridge's reason", async () => {
		const api = withRealm({
			ok: false,
			error: { code: "unauthorized", status: 401, message: "missing token" },
		});
		await expect(api.invoke("test", "echo", {})).rejects.toMatchObject({
			code: "unauthorized",
		});
		await expect(api.ready).rejects.toMatchObject({
			code: "bridge-refused",
			status: 401,
			message: expect.stringContaining("missing token"),
		});
	});
});
