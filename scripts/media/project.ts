/**
 * The media e2e's project on disk: config, entry, page, and the `node_modules/crust` symlink that
 * lets the framework resolve from a checkout. Split from `e2e-media.ts` (which owns the verdicts)
 * when the harness reached the 200-line cap.
 */
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { entry, page } from "./fixture.ts";

export interface MediaFixture {
	/** The generated project directory. */
	appDir: string;
	/** `dist/<name>.app`. */
	appPath: string;
	/** The bundle's executable, spawned directly so Gatekeeper never sees a LaunchServices open. */
	builtBinary: string;
}

export async function writeMediaProject(options: {
	root: string;
	/** The crust checkout the project's `node_modules/crust` points at. */
	repo: string;
	bundleId: string;
	name: string;
	/** `security.microphone`: the sentence macOS shows in its prompt. */
	purpose: string;
}): Promise<MediaFixture> {
	const appDir = join(options.root, "app");
	const appPath = join(appDir, "dist", `${options.name}.app`);
	const builtBinary = join(appPath, "Contents", "MacOS", "crust-app");
	await mkdir(join(appDir, "public"), { recursive: true });
	await mkdir(join(appDir, "node_modules"), { recursive: true });
	await symlink(options.repo, join(appDir, "node_modules", "crust"), "dir");
	await writeFile(
		join(appDir, "package.json"),
		`{"name":"crust-e2e-media","private":true,"type":"module"}\n`,
		"utf8",
	);
	await writeFile(join(appDir, "public", "index.html"), page, "utf8");
	await writeFile(join(appDir, "main.ts"), entry, "utf8");
	await writeFile(
		join(appDir, "crust.config.ts"),
		`import type { CrustConfig } from "crust";

export default {
	app: { id: "${options.bundleId}", name: "${options.name}", version: "0.0.0" },
	windows: [{ label: "main", url: "/", width: 420, height: 220, title: "${options.name}" }],
	security: { microphone: "${options.purpose}" },
} satisfies CrustConfig;
`,
		"utf8",
	);
	return { appDir, appPath, builtBinary };
}
