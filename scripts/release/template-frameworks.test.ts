/**
 * The Vite templates are three copies of one shape. `crust.config.ts`, the
 * pinned dev URL, the build output and the plugin list must not drift apart:
 * a template that builds to a different directory is a blank embedded window.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

interface Manifest {
	scripts: Record<string, string>;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
}

const file = (name: string, path: string): Promise<string> =>
	Bun.file(join(ROOT, "templates", name, path)).text();

const manifest = (name: string): Promise<Manifest> =>
	Bun.file(join(ROOT, "templates", name, "package.json")).json();

const VITE_TEMPLATES = [
	{
		name: "svelte",
		framework: "svelte",
		plugin: "@sveltejs/vite-plugin-svelte",
		call: "svelte()",
		component: "App.svelte",
	},
	{
		name: "vue",
		framework: "vue",
		plugin: "@vitejs/plugin-vue",
		call: "vue()",
		component: "App.vue",
	},
] as const;

for (const row of VITE_TEMPLATES) {
	describe(`templates/${row.name}`, () => {
		test("build delegates to crust, frontend keeps a Vite escape hatch", async () => {
			const { scripts } = await manifest(row.name);
			expect(scripts.build).toBe("crust build");
			expect(scripts.build).not.toContain("vite");
			expect(scripts.frontend).toContain("vite build");
		});

		test("crust.config.ts pins the dev URL and the shared dist/web output", async () => {
			const config = await file(row.name, "crust.config.ts");
			expect(config).toContain('url: "http://localhost:5173"');
			expect(config).toContain('assets: "dist/web"');
			expect(config).toContain("beforeBuildCommand");
			expect(config).toContain("vite build");
		});

		test("vite.config.ts installs the framework plugin and the crust client", async () => {
			const config = await file(row.name, "vite.config.ts");
			expect(config).toContain(`from "${row.plugin}"`);
			expect(config).toContain('from "crust/vite"');
			expect(config).toContain("plugins: [");
			expect(config).toContain(row.call);
			expect(config).toContain("crust()");
			expect(config).toContain("port: 5173");
			expect(config).toContain("strictPort: true");
			expect(config).toContain('outDir: "dist/web"');
		});

		test("the page mounts the framework component into #app", async () => {
			const html = await file(row.name, "index.html");
			expect(html).toContain('id="app"');
			expect(html).toContain('src="/src/main.ts"');
			const entry = await file(row.name, "src/main.ts");
			expect(entry).toContain(row.component);
			const component = await file(row.name, `src/${row.component}`);
			expect(component).toContain('invoke("greet"');
			expect(component).toContain(`{ name: "${row.name}" }`);
		});

		test("dependency ranges are pinned, and Vite matches the React template", async () => {
			const current = await manifest(row.name);
			const react = await manifest("react");
			expect(current.dependencies[row.framework]).toMatch(/^\^/);
			expect(current.devDependencies[row.plugin]).toMatch(/^\^/);
			expect(current.devDependencies.vite).toBe(react.devDependencies.vite);
			expect(current.dependencies.crust).toBe(react.dependencies.crust);
		});
	});
}
