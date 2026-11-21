/**
 * A dev-server page never passes through the bridge document route, so the Vite plugin
 * injects the handshake token. It must be the token minted for that page's window label,
 * not main's — otherwise every dev window runs with main's grants.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, stopAll } from "./server/fixtures.ts";
import { publishDevHandshake, removeDevHandshake } from "../runtime-host.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR, crust } from "../vite.ts";

interface Tag {
	tag?: string;
	children?: unknown;
}

async function injected(url: string): Promise<{ url: string; token: string } | undefined> {
	const plugin = crust() as unknown as {
		transformIndexHtml: {
			handler: (html: string, ctx: unknown) => Promise<{ tags?: Tag[] } | string | undefined>;
		};
	};
	const result = await plugin.transformIndexHtml.handler("<html></html>", { originalUrl: url });
	const tags =
		result && typeof result === "object" && "tags" in result ? (result.tags ?? []) : [];
	const script = tags.find(
		(tag) =>
			tag.tag === "script" &&
			typeof tag.children === "string" &&
			tag.children.includes("__CRUST__"),
	);
	const match = /window\.__CRUST__ = (\{.*?\});/s.exec(String(script?.children ?? ""));
	return match === null
		? undefined
		: (JSON.parse(match[1] ?? "{}") as { url: string; token: string });
}

afterEach(async () => {
	delete process.env[BRIDGE_URL_VAR];
	delete process.env[BRIDGE_TOKEN_VAR];
	delete process.env.CRUST_DEV_FILE;
	await stopAll();
});

describe("dev label-bound handshake", () => {
	test("mints one token per configured label and removes the file on stop", () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-dev-labels-"));
		const bridge = start();
		try {
			const path = publishDevHandshake(dir, bridge, ["main", "admin"]);
			const written = JSON.parse(readFileSync(path, "utf8")) as {
				tokens?: Record<string, string>;
			};
			expect(Object.keys(written.tokens ?? {}).sort()).toEqual(["admin", "main"]);
			expect(written.tokens?.admin).not.toBe(written.tokens?.main);

			removeDevHandshake(dir);
			expect(() => readFileSync(path)).toThrow();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the plugin picks the token matching the page's window label", async () => {
		const bridge = start();
		const dir = mkdtempSync(join(tmpdir(), "crust-dev-page-"));
		try {
			const path = publishDevHandshake(dir, bridge, ["main", "admin"]);
			process.env.CRUST_DEV_FILE = path;
			const main = await injected("http://localhost:5173/?window=main");
			const admin = await injected("http://localhost:5173/?window=admin");
			expect(main?.token).not.toBe(admin?.token);

			const served = await fetch(`${bridge.url}/?token=${admin?.token}`, {
				redirect: "manual",
			});
			expect(served.status).toBe(200);
		} finally {
			removeDevHandshake(dir);
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
