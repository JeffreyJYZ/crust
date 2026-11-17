/**
 * A reload is only useful if the reloaded document is the edited one: `indexHtml`
 * is the startup snapshot, so plain-HTML dev must read public/index.html afresh.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge } from "../server.ts";
import { RELOAD_ENV } from "./events.ts";
import { stopAll, testPlugin, track } from "./fixtures.ts";

afterEach(() => {
	delete process.env[RELOAD_ENV];
	return stopAll();
});

describe("plain-HTML dev document", () => {
	test("an edit to public/index.html is served after the reload", async () => {
		const dir = mkdtempSync(join(tmpdir(), "crust-doc-reload-"));
		try {
			const root = join(dir, "public");
			mkdirSync(root);
			const first = "<html><body>UNIQUE_FIRST</body></html>";
			writeFileSync(join(root, "index.html"), first);
			process.env[RELOAD_ENV] = join(dir, "dev-reload");
			// The snapshot the runtime took at startup, exactly what documentResponse used to prefer.
			const bridge = track(startBridge({ handlers: [testPlugin], root, indexHtml: first }));

			const document = async (): Promise<string> =>
				await (
					await fetch(`${bridge.url}/?token=${encodeURIComponent(bridge.token)}`)
				).text();

			expect(await document()).toContain("UNIQUE_FIRST");
			writeFileSync(join(root, "index.html"), "<html><body>UNIQUE_SECOND</body></html>");
			const edited = await document();
			expect(edited).toContain("UNIQUE_SECOND");
			expect(edited).not.toContain("UNIQUE_FIRST");
			// The bootstrap is still injected into the fresh document.
			expect(edited).toContain("installCrust");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
