/**
 * Lane L7: the release scaffold is a real file the scaffold copies, and the guide's
 * publisher recipe matches what the updater verifier accepts. A doc that names a
 * command crust does not have, or a workflow that calls one, is the defect here.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKFLOW = ".github/workflows/release.yml";
const TEMPLATES = ["default", "react", "next", "svelte", "vue"] as const;

describe("every scaffold ships a release workflow", () => {
	for (const name of TEMPLATES) {
		test(`templates/${name}/${WORKFLOW}`, async () => {
			const text = await Bun.file(join(ROOT, "templates", name, WORKFLOW)).text();
			expect(text).toContain('tags: ["v*"]');
			// Current releases at the moment this file was written.
			expect(text).toContain("actions/checkout@v7");
			expect(text).toContain("oven-sh/setup-bun@v2");
			// The workflow only calls commands crust actually has.
			expect(text).toContain("run: bun run build");
			expect(text).toContain("bunx crust package --format dmg");
			expect(text).toContain("gh release create");
			expect(text).not.toContain("crust update publish");
			expect(text).not.toContain("crust release");
		});
	}

	test("crust init copies each scaffold's own workflow", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "crust-release-scaffold-"));
		try {
			const { init } = await import("./init.ts");
			for (const name of TEMPLATES) {
				const target = join(workspace, name);
				const options: Record<string, unknown> = { dir: target };
				if (name !== "default") options[name] = true;
				expect(await init(options as never)).toBe(0);
				const written = await Bun.file(join(target, WORKFLOW)).text();
				expect(written).toContain("name: release");
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});

describe("the release guide tells the truth", () => {
	const page = (): Promise<string> =>
		Bun.file(join(ROOT, "site/app/docs/guides/release/page.mdx")).text();

	test("it says plainly what crust has no command for", async () => {
		const text = await page();
		expect(text).toContain("no `crust release`");
		expect(text).toContain("no `crust update publish`");
		expect(text).toContain("no app `--target` flag");
	});

	test("the publisher recipe matches the verifier's key and signature sizes", async () => {
		const text = await page();
		expect(text).toContain("openssl genpkey -algorithm ed25519");
		expect(text).toContain("openssl pkeyutl -sign -inkey key.pem -rawin");
		expect(text).toContain("tail -c 32 | base64");
		expect(text).toContain("shasum -a 256");
		expect(text).toContain('"sha256"');
		expect(text).toContain('"signature"');
		expect(text).toContain('"pubkey"');
		// The recipe must point at the contract that explains the receipt rule.
		expect(text).toContain("(/docs/guides/updater)");
	});

	test("the cross-compile answer is one command per host, not a flag", async () => {
		const text = await page();
		expect(text).toContain("bunx crust build --help");
		expect(text).toContain("run the same `bunx crust build` on a runner of each OS");
	});
});
