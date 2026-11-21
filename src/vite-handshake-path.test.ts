/**
 * The dev server is a separate process, so the handshake path must travel in the
 * environment; deriving it from the child's cwd alone loses the runtime's file.
 * A page with no injected client must say which path it looked at.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { bridgeEnv } from "./cli/dev/frontend.ts";
import { devHandshakePath, DEV_HANDSHAKE_FILE_VAR } from "./dev-handshake-path.ts";
import { handshakeFile, crust } from "./vite.ts";
import { BRIDGE_TOKEN_VAR, BRIDGE_URL_VAR } from "./vite.ts";

interface Tag {
	tag?: string;
	children?: unknown;
}

afterEach(() => {
	delete process.env[DEV_HANDSHAKE_FILE_VAR];
	delete process.env[BRIDGE_URL_VAR];
	delete process.env[BRIDGE_TOKEN_VAR];
});

describe("dev handshake path precedence", () => {
	test("dev passes the handshake path to the frontend child", () => {
		const project = "/the/runtime/project";
		process.env[BRIDGE_URL_VAR] = "http://127.0.0.1:1";
		process.env[BRIDGE_TOKEN_VAR] = "a-token";
		const env = bridgeEnv("http://localhost:5173", project);
		expect(env[DEV_HANDSHAKE_FILE_VAR]).toBe(devHandshakePath(project));
	});

	test("the env path wins over a mismatched cwd", () => {
		const explicit = devHandshakePath("/the/dev/server/cwd");
		process.env[DEV_HANDSHAKE_FILE_VAR] = explicit;
		expect(handshakeFile("/the/runtime/project")).toBe(explicit);
	});

	test("without env the path is derived from the given cwd", () => {
		const project = "/the/runtime/project";
		expect(handshakeFile(project)).toBe(devHandshakePath(project));
	});

	test("a missing handshake names the exact path it looked at", async () => {
		const file = devHandshakePath("/the/runtime/project");
		process.env[DEV_HANDSHAKE_FILE_VAR] = file;
		const warnings: string[] = [];
		const warn = console.warn;
		console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
		try {
			const plugin = crust() as unknown as {
				transformIndexHtml: {
					handler: (html: string, ctx: unknown) => Promise<{ tags?: Tag[] } | string>;
				};
			};
			const result = await plugin.transformIndexHtml.handler("<html></html>", {});
			expect(typeof result).toBe("string");
			expect(warnings.join("\n")).toContain(file);
		} finally {
			console.warn = warn;
		}
	});
});
