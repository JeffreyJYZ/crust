/**
 * The framework flags are a contract between the CLI, init and the standalone
 * gate: the CLI must set the flag, init must copy that template, and the gate
 * must expect exactly the files the template ships. A drift in any one reddens
 * a macOS job that nobody can reproduce by reading TypeScript. The argv-level
 * refusals now live in cli-contract.test.ts; here the options are built direct.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { InitOptions } from "./init";
import { crustDep, init } from "./init";
import { OPTION_DESCRIPTIONS } from "./help";

const scratchDirs: string[] = [];

async function scratch(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "crust-init-"));
	scratchDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of scratchDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Files the standalone gate counts, excluding the dotfile it checks apart. */
const COUNTS = { react: 6, svelte: 7, vue: 7, solid: 9, "": 6 } as const;

/** Glob the way scripts/build-standalone.ts does, so the two agree by shape. */
function listed(dir: string): string[] {
	try {
		return [...new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })];
	} catch {
		return [];
	}
}

describe("init framework flags", () => {
	for (const flag of ["react", "svelte", "vue", "solid"] as const) {
		test(`--${flag} scaffolds its template and substitutes every token`, async () => {
			const target = join(await scratch(), "My App");
			const options: InitOptions = { dir: target };
			options[flag] = true;
			expect(await init(options)).toBe(0);

			expect(listed(target)).toHaveLength(COUNTS[flag]);
			expect(await Bun.file(join(target, ".gitignore")).text()).toContain("node_modules/");
			const config = await Bun.file(join(target, "crust.config.ts")).text();
			expect(config).toContain("app.crust.my-app");
			expect(config).toContain('name: "My App"');
			expect(config).not.toContain("{{");
		});
	}

	test("two flags at once are refused, naming both", async () => {
		const errors = spyOn(console, "error").mockImplementation(() => {});
		try {
			const target = join(await scratch(), "app");
			const options: InitOptions = { dir: target, react: true, vue: true };
			expect(options.react).toBe(true);
			expect(options.vue).toBe(true);
			expect(await init(options)).toBe(1);
			const said = errors.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(said).toContain("--react");
			expect(said).toContain("--vue");
			expect(listed(target)).toHaveLength(0);
		} finally {
			errors.mockRestore();
		}
	});

	// The four "flag outside init is refused" argv rows now live in
	// cli-contract.test.ts, which drives the real entry point instead of parse().

	test("help lists every scaffold", () => {
		// cac renders these descriptions in both help screens; there is no
		// hand-written USAGE block to read them back out of any more.
		for (const flag of ["react", "next", "svelte", "vue", "solid"] as const)
			expect(Object.keys(OPTION_DESCRIPTIONS)).toContain(flag);
	});

	test("a checkout path with backslashes still yields parseable package.json", () => {
		// A native Windows root such as C:\a\crust must survive substitution into
		// the JSON template: raw \a and \c are not valid JSON escapes.
		const spec = crustDep("C:\\a\\crust", true, "0.1.29");
		// Raw substitution, the way applyTokens fills the template: no escaping.
		const manifest = `{"devDependencies":{"crust":"${spec}"}}`;
		expect(() => JSON.parse(manifest)).not.toThrow();
		expect(JSON.parse(manifest).devDependencies.crust).toBe("link:C:/a/crust");
	});

	test("a release version pins the matching tag", () => {
		expect(crustDep("/cache/crust", false, "0.1.29")).toBe("github:JeffreyJYZ/crust#v0.1.29");
	});

	test("a non-release version stays unpinned", () => {
		// A `-dev` build has no tag; pinning v0.1.30-dev would break install.
		expect(crustDep("/cache/crust", false, "0.1.30-dev")).toBe("github:JeffreyJYZ/crust");
	});

	test("a checkout still links the live tree whatever the version", () => {
		expect(crustDep("/checkout/crust", true, "0.1.29")).toBe("link:/checkout/crust");
	});

	test("the standalone gate asserts these exact counts", async () => {
		const source = await readFile(
			join(import.meta.dir, "..", "..", "scripts/build-standalone.ts"),
			"utf8",
		);
		for (const [flag, count] of Object.entries(COUNTS)) {
			const gateFlag = flag === "" ? "" : `--${flag}`;
			expect(source).toContain(`["${gateFlag}", ${count}]`);
		}
	});
});
