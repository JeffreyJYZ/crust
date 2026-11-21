/**
 * A single-file app has no `crust.config.ts`, so before this line existed it was locked to
 * `DEFAULT_CSP` — no `connect-src` for a provider and no microphone. The declaration is the file's
 * own comment, and a bad one is refused by the same validator a project config goes through.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectSingle } from "./single-detect.ts";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-single-security-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const CSP =
	"default-src 'self'; script-src 'self' 'unsafe-inline'; " +
	"connect-src 'self' https://api.example.com wss://api.example.com";

describe("a single file declares security", () => {
	test("a module's crust-security line reaches the built config", async () => {
		await withDir(async (dir) => {
			await writeFile(
				join(dir, "app.tsx"),
				[
					`// crust-security: ${JSON.stringify({ csp: CSP, microphone: "Example records voice memos." })}`,
					"export default function App() { return null; }",
					"",
				].join("\n"),
				"utf8",
			);
			const detection = await detectSingle({ single: "app.tsx", dir });
			expect(detection.kind).toBe("app");
			if (detection.kind !== "app") return;
			expect(detection.app.config.security?.csp).toBe(CSP);
			expect(detection.app.config.security?.microphone).toBe("Example records voice memos.");
		});
	});

	test("an html page uses its own comment syntax", async () => {
		await withDir(async (dir) => {
			await writeFile(
				join(dir, "page.html"),
				`<!-- crust-security: ${JSON.stringify({ microphone: "Example records voice memos." })} -->\n<h1>hi</h1>\n`,
				"utf8",
			);
			const detection = await detectSingle({ single: "page.html", dir });
			expect(detection.kind).toBe("app");
			if (detection.kind !== "app") return;
			expect(detection.app.config.security?.microphone).toBe("Example records voice memos.");
		});
	});

	test("no line leaves security absent, so an old single file is unchanged", async () => {
		await withDir(async (dir) => {
			await writeFile(join(dir, "app.tsx"), "export default 1;\n", "utf8");
			const detection = await detectSingle({ single: "app.tsx", dir });
			expect(detection.kind).toBe("app");
			if (detection.kind !== "app") return;
			expect(detection.app.config.security).toBeUndefined();
		});
	});

	test("a microphone that is not a sentence is refused by name", async () => {
		await withDir(async (dir) => {
			await writeFile(
				join(dir, "app.tsx"),
				`// crust-security: ${JSON.stringify({ microphone: "mic" })}\nexport default 1;\n`,
				"utf8",
			);
			const detection = await detectSingle({ single: "app.tsx", dir });
			expect(detection.kind).toBe("error");
			if (detection.kind !== "error") return;
			expect(detection.message).toContain("security.microphone");
		});
	});

	test("a csp whose script-src omits 'unsafe-inline' is refused", async () => {
		await withDir(async (dir) => {
			const csp = "default-src 'self'; script-src 'self'; connect-src 'self'";
			await writeFile(
				join(dir, "app.tsx"),
				`// crust-security: ${JSON.stringify({ csp })}\nexport default 1;\n`,
				"utf8",
			);
			const detection = await detectSingle({ single: "app.tsx", dir });
			expect(detection.kind).toBe("error");
			if (detection.kind !== "error") return;
			expect(detection.message).toContain("security.csp");
		});
	});

	test("a line that is not JSON names the file and the shape", async () => {
		await withDir(async (dir) => {
			await writeFile(
				join(dir, "app.tsx"),
				"// crust-security: {csp: 'self'}\nexport default 1;\n",
				"utf8",
			);
			const detection = await detectSingle({ single: "app.tsx", dir });
			expect(detection.kind).toBe("error");
			if (detection.kind !== "error") return;
			expect(detection.message).toContain("app.tsx");
			expect(detection.message).toContain("crust-security");
		});
	});
});
