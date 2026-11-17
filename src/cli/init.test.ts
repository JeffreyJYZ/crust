/**
 * The framework flags are a contract between parse, init and the standalone
 * gate: parse must set the flag, init must copy that template, and the gate must
 * expect exactly the files the template ships. A drift in any one reddens a
 * macOS job that nobody can reproduce by reading TypeScript.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { init } from "./init";
import { parse } from "./parse";
import { USAGE } from "./usage";

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
const COUNTS = { react: 6, svelte: 7, vue: 7, "": 6 } as const;

/** Glob the way scripts/build-standalone.ts does, so the two agree by shape. */
function listed(dir: string): string[] {
	try {
		return [...new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })];
	} catch {
		return [];
	}
}

describe("init framework flags", () => {
	for (const flag of ["react", "svelte", "vue"] as const) {
		test(`--${flag} scaffolds its template and substitutes every token`, async () => {
			const target = join(await scratch(), "My App");
			const parsed = parse(["init", target, `--${flag}`]);
			expect(parsed.error).toBeUndefined();
			expect(await init(parsed.options)).toBe(0);

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
			const parsed = parse(["init", target, "--react", "--vue"]);
			expect(parsed.options.react).toBe(true);
			expect(parsed.options.vue).toBe(true);
			expect(await init(parsed.options)).toBe(1);
			const said = errors.mock.calls.map((call) => call.join(" ")).join("\n");
			expect(said).toContain("--react");
			expect(said).toContain("--vue");
			expect(listed(target)).toHaveLength(0);
		} finally {
			errors.mockRestore();
		}
	});

	test("a framework flag outside init is a parse error", () => {
		for (const flag of ["react", "next", "svelte", "vue"] as const) {
			expect(parse(["dev", `--${flag}`]).error).toBe(`--${flag} only applies to init`);
		}
	});

	test("help lists all four scaffolds", () => {
		for (const flag of ["--react", "--next", "--svelte", "--vue"])
			expect(USAGE).toContain(flag);
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
