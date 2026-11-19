import { buildDmg, type DmgOptions } from "@/packaging/dmg";
import { formatBytes } from "@/packaging/build";
import { line } from "./util.ts";

/**
 * The disk-image stage inside `crust build --dmg`: stage the app beside an
 * `/Applications` symlink and compress that folder into a drag-to-Applications
 * image. It runs last, after signing and stapling, so the image holds the
 * notarized app rather than an earlier, unsigned copy.
 */
export async function dmgStage(options: DmgOptions): Promise<number> {
	const result = await buildDmg(options);
	line("bundle", options.appPath);
	line("image", `${result.dmgPath} (${formatBytes(result.bytes)})`);
	line("volume", result.volumeName);
	return 0;
}
