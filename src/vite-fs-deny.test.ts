/**
 * A per-label handshake is only safe if no page can read it. The runtime writes it
 * in the OS temp dir and the Vite plugin also denies `.crust/**` and any handshake
 * filename, so a `main` page cannot fetch the `admin` token out of a static file.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { devHandshakePath, DEV_HANDSHAKE_DENY } from "./dev-handshake-path.ts";
import { crust } from "./vite.ts";

let server: ViteDevServer | undefined;

afterEach(async () => {
	await server?.close();
	server = undefined;
	delete process.env.CRUST_DEV_FILE;
});

async function listen(root: string): Promise<string> {
	server = await createServer({
		root,
		configFile: false,
		logLevel: "silent",
		plugins: [crust()],
		server: { host: "127.0.0.1", port: 0 },
	});
	await server.listen();
	return server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${server.config.server.port}/`;
}

const FORBIDDEN = 403;

describe("dev handshake exposure", () => {
	test("the plugin denies .crust and every handshake file name", async () => {
		const plugin = crust();
		const hook = plugin.config as unknown as
			((ctx: unknown, options: unknown) => unknown) | undefined;
		const config =
			typeof hook === "function"
				? await hook({ command: "serve", mode: "development" }, {})
				: undefined;
		const deny = (config as { server?: { fs?: { deny?: string[] } } })?.server?.fs?.deny ?? [];
		for (const pattern of DEV_HANDSHAKE_DENY) expect(deny).toContain(pattern);
	});

	test("a served page cannot fetch another label's token", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-vite-deny-"));
		try {
			mkdirSync(join(dir, ".crust"), { recursive: true });
			writeFileSync(
				join(dir, ".crust", "dev.json"),
				JSON.stringify({ url: "http://127.0.0.1:1", token: "PROJECT-MAIN" }),
			);
			// A copy with the temp handshake's name inside the root: both deny rules must fire.
			writeFileSync(
				join(dir, "crust-dev-probe.json"),
				JSON.stringify({ tokens: { main: "MAIN-TOKEN", admin: "ADMIN-TOKEN" } }),
			);
			writeFileSync(join(dir, "index.html"), "<html><head></head><body>ok</body></html>");
			writeFileSync(
				devHandshakePath(dir),
				JSON.stringify({
					url: "http://127.0.0.1:1",
					token: "MAIN-TOKEN",
					tokens: { main: "MAIN-TOKEN", admin: "ADMIN-TOKEN" },
				}),
				{ mode: 0o600 },
			);
			process.env.CRUST_DEV_FILE = devHandshakePath(dir);
			const base = await listen(dir);

			const healthy = await fetch(`${base}index.html`);
			expect(healthy.status).toBe(200);

			for (const path of [".crust/dev.json", "crust-dev-probe.json"]) {
				const response = await fetch(`${base}${path}`);
				expect([FORBIDDEN, 404]).toContain(response.status);
				expect(await response.text()).not.toContain("ADMIN-TOKEN");
			}

			const page = await fetch(`${base}?window=main`);
			const html = await page.text();
			expect(html).toContain("MAIN-TOKEN");
			expect(html).not.toContain("ADMIN-TOKEN");
			expect(html).not.toContain("PROJECT-MAIN");
		} finally {
			rmSync(devHandshakePath(dir), { force: true });
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);
});
