/**
 * The default-export / React half of single-file mode, previously unguarded:
 * shape detection, the React 18 floor, and the generated mount module.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPage } from "./single-build.ts";
import { detectSingle, type SingleApp } from "./single-detect.ts";
import { documentSource, hasDefaultExport, mountSource, requireReact } from "./single-page.ts";

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "crust-single-react-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function fakeReact(dir: string, name: "react" | "react-dom", version: string): Promise<void> {
	const pkg = join(dir, "node_modules", name);
	await mkdir(pkg, { recursive: true });
	await writeFile(join(pkg, "package.json"), JSON.stringify({ name, version }), "utf8");
}

describe("hasDefaultExport", () => {
	test("sees a real default export at the start of a line", () => {
		expect(hasDefaultExport("export default function App() { return null; }\n")).toBe(true);
	});

	test("sees a default export after other code on one line", () => {
		expect(hasDefaultExport("const A = () => null; export default A;\n")).toBe(true);
	});

	test("sees an alias export of default", () => {
		expect(hasDefaultExport("const A = 1;\nexport { A as default };\n")).toBe(true);
	});

	test("ignores export default inside a template literal", () => {
		const source = "document.body.textContent = `\nexport default function Fake(){}\n`;\n";
		expect(hasDefaultExport(source)).toBe(false);
	});

	test("ignores export default inside a block comment and a string", () => {
		expect(hasDefaultExport("/* export default X */\n")).toBe(false);
		expect(hasDefaultExport('const s = "export default X";\n')).toBe(false);
	});

	test("ignores a type-only default export", () => {
		expect(hasDefaultExport("export type { X as default };\n")).toBe(false);
	});

	test("a side-effect page has no default export", () => {
		expect(hasDefaultExport('document.body.textContent = "hi";\n')).toBe(false);
	});
});

describe("mountSource", () => {
	test("imports the page file and mounts with the React 18 createRoot API", () => {
		const app = { file: "/tmp/project/app.tsx" } as SingleApp;
		const source = mountSource(app);
		expect(source).toContain(JSON.stringify(app.file));
		expect(source).toContain('import("react-dom/client")');
		expect(source).toContain("createRoot(mount)");
	});
});

describe("documentSource dev reload", () => {
	const app = { name: "app", file: "/tmp/project/app.tsx" } as SingleApp;

	test("re-runs the module instead of reloading the token-gated document", () => {
		const html = documentSource(app, "page.js", true);
		// A native window scrubs ?token= from the document URL, so location.reload() gets a 401.
		expect(html).not.toContain("location.reload()");
		expect(html).toContain('import(entry + "?t=" + Date.now())');
		// The entry is captured before the module can replace the body it lives in.
		expect(html.indexOf("document.querySelector")).toBeLessThan(html.indexOf("function tick"));
		expect(html).toContain("setInterval(tick, 400)");
	});

	test("a built document carries no dev poller", () => {
		const html = documentSource(app, "page.js", false);
		expect(html).not.toContain("setInterval(tick");
		expect(html).not.toContain("__crust_reload");
	});
});

describe("requireReact", () => {
	test("accepts matching React 18+ installs", async () => {
		await withDir(async (dir) => {
			await fakeReact(dir, "react", "18.3.1");
			await fakeReact(dir, "react-dom", "18.3.1");
			expect(await requireReact(dir, "app.tsx").then(() => true)).toBe(true);
		});
	});

	test("rejects React 17 by name with the React 18 floor", async () => {
		await withDir(async (dir) => {
			await fakeReact(dir, "react", "17.0.2");
			await fakeReact(dir, "react-dom", "17.0.2");
			const failure = await requireReact(dir, "app.tsx").catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(Error);
			expect((failure as Error).message).toContain("React 18+");
			expect((failure as Error).message).toContain("17.0.2");
		});
	});

	test("rejects a missing install with the add command", async () => {
		await withDir(async (dir) => {
			const failure = await requireReact(dir, "app.tsx").catch((error: unknown) => error);
			expect((failure as Error).message).toContain("bun add react react-dom");
		});
	});

	test("rejects mismatched React majors", async () => {
		await withDir(async (dir) => {
			await fakeReact(dir, "react", "18.3.1");
			await fakeReact(dir, "react-dom", "19.0.0");
			const failure = await requireReact(dir, "app.tsx").catch((error: unknown) => error);
			expect((failure as Error).message).toContain("mismatched React majors");
		});
	});
});

describe("buildPage with a default export", () => {
	test("rejects a React 17 project before bundling", async () => {
		await withDir(async (dir) => {
			await writeFile(
				join(dir, "app.tsx"),
				"export default function App() { return null; }\n",
				"utf8",
			);
			await fakeReact(dir, "react", "17.0.2");
			await fakeReact(dir, "react-dom", "17.0.2");
			const detection = await detectSingle({ single: "app.tsx", dir });
			if (detection.kind !== "app") throw new Error(`expected an app, got ${detection.kind}`);

			const failure = await buildPage(detection.app, { dev: true }).catch(
				(error: unknown) => error,
			);
			expect(failure).toBeInstanceOf(Error);
			expect((failure as Error).message).toContain("React 18+");
		});
	});
});
