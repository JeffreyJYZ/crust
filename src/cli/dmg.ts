import { resolve } from "node:path";
import { loadConfig } from "@/config";
import { buildDmg } from "@/packaging/dmg";
import { formatBytes } from "@/packaging/build";
import { fail, findAppBundle, line, type CliOptions } from "./util.ts";

/**
 * `crust dmg` — stage the app beside an `/Applications` symlink and compress
 * that folder into a drag-to-Applications disk image. Requires `crust build`.
 */
export async function dmg(options: CliOptions): Promise<number> {
	const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
	console.log(`crust dmg — ${loaded.path}`);
	const config = loaded.config;

	const bundle = await findAppBundle(options.dir);
	if (!bundle) {
		return fail("dmg", `no .app in ${resolve(options.dir, "dist")} — run crust build first`);
	}

	const result = await buildDmg({
		appPath: bundle,
		out: resolve(options.dir, `dist/${config.app.name}-${config.app.version}.dmg`),
		volumeName: config.app.name,
	});

	line("bundle", bundle);
	line("image", `${result.dmgPath} (${formatBytes(result.bytes)})`);
	line("volume", result.volumeName);
	return 0;
}
