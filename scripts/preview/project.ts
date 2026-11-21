/**
 * The preview e2e's project on disk: a config with one `fs.scope` prefix, an entry that mounts the
 * plugin exactly as the runtime will (`createPreviewPlugin()` with no arguments, so the boundary is
 * inherited rather than passed), a page, and the `node_modules/crust` symlink that lets the framework
 * resolve from a checkout.
 */
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PreviewFixture {
	/** The generated project directory. */
	appDir: string;
	/** The directory `fs.scope` allows: the docx lives here. */
	inside: string;
	/** A directory the scope does not allow: the refusal points at a file in it. */
	outside: string;
	/** The built app's executable, spawned directly so Gatekeeper never sees a LaunchServices open. */
	builtBinary: string;
}

/** The entry the fixture runs. Every proof is one `preview.<name> <json>` line on stdout. */
function entry(file: string, outside: string): string {
	return `import { app } from "crust";
import { createPreviewPlugin } from "crust/plugin";

// Exactly the registration the runtime will use: no scope option, so the boundary comes from the
// config's fs.scope through the ambient instance, which is the wiring this proof covers.
const preview = createPreviewPlugin();

function say(tag: string, value: unknown): void {
	console.log(tag + " " + JSON.stringify(value));
}

app.on("ready", async () => {
	try {
		const shown = await preview.commands.show({ path: ${JSON.stringify(file)}, width: 520, height: 380 });
		say("preview.show", shown);
		// Give the pump one tick and QuickLook one paint before reading the panel's own visibility.
		await Bun.sleep(500);
		const hidden = await preview.commands.hide();
		say("preview.hide", hidden);
		try {
			await preview.commands.show({ path: ${JSON.stringify(outside)} });
			say("preview.refused", { code: "none", message: "the outside path was NOT refused" });
		} catch (error) {
			const failed = error as { code?: string; message?: string };
			say("preview.refused", { code: failed.code, message: failed.message });
		}
	} catch (error) {
		say("preview.error", { message: error instanceof Error ? error.message : String(error) });
	}
	say("preview.done", { ok: true });
	app.quit();
});

await app.run();
`;
}

export async function writePreviewProject(options: {
	root: string;
	/** The crust checkout the project's `node_modules/crust` points at. */
	repo: string;
	bundleId: string;
	name: string;
	/** Absolute path of the document to preview; it must sit under `inside`. */
	file: string;
	/** Absolute path outside the scope, for the refusal. */
	outsideFile: string;
}): Promise<PreviewFixture> {
	const appDir = join(options.root, "app");
	const inside = join(options.root, "inside");
	const outside = join(options.root, "outside");
	const builtBinary = join(
		appDir,
		"dist",
		`${options.name}.app`,
		"Contents",
		"MacOS",
		"crust-app",
	);
	await mkdir(join(appDir, "public"), { recursive: true });
	await mkdir(join(appDir, "node_modules"), { recursive: true });
	await symlink(options.repo, join(appDir, "node_modules", "crust"), "dir");
	await writeFile(
		join(appDir, "package.json"),
		`{"name":"crust-e2e-preview","private":true,"type":"module"}\n`,
		"utf8",
	);
	await writeFile(
		join(appDir, "public", "index.html"),
		"<!doctype html><title>Preview e2e</title><main>preview e2e</main>\n",
		"utf8",
	);
	await writeFile(join(appDir, "main.ts"), entry(options.file, options.outsideFile), "utf8");
	await writeFile(
		join(appDir, "crust.config.ts"),
		`import type { CrustConfig } from "crust";

export default {
	app: { id: "${options.bundleId}", name: "${options.name}", version: "0.0.0" },
	windows: [{ label: "main", url: "/", width: 520, height: 380, title: "${options.name}" }],
	fs: { scope: [${JSON.stringify(inside)}] },
	preview: { width: 520, height: 380 },
} satisfies CrustConfig;
`,
		"utf8",
	);
	return { appDir, inside, outside, builtBinary };
}
