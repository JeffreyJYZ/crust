/**
 * `crust package` — every release artefact this project can build, one line each.
 * A format whose tool is absent prints its `requires` line and sets exit 1; it
 * never throws, so the remaining formats still build.
 */

import { dirname, resolve } from "node:path";
import { loadConfig } from "@/config";
import { buildAppImage, describeAppImage } from "@/packaging/appimage";
import { buildDmg, describeDmg } from "@/packaging/dmg";
import { type Exec, buildNsis, describeNsis } from "@/packaging/nsis";
import type { PackageFormat } from "./package/format.ts";
import { appImageOptions, dmgOptions, nsisOptions, type PackageInputs } from "./package/options.ts";
import { exists, fail, findAppBundle, line, type CliOptions } from "./util.ts";

/** The tool runner, injected by a test so no builder shells out. */
export interface PackageSeams {
	exec?: Exec;
}

interface Outcome {
	ok: boolean;
	text: string;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function runFormat(
	format: PackageFormat,
	inputs: PackageInputs,
	seams: PackageSeams,
): Promise<Outcome> {
	try {
		if (format === "dmg") {
			return { ok: true, text: describeDmg(await buildDmg(dmgOptions(inputs))) };
		}
		if (format === "appimage") {
			if (!inputs.iconPath) {
				return {
					ok: false,
					text: "appimage  unavailable  app.icon is not set — it needs a 512×512 PNG",
				};
			}
			const result = await buildAppImage(
				appImageOptions(inputs, inputs.iconPath, seams.exec),
			);
			return { ok: result.ok, text: describeAppImage(result) };
		}
		const result = await buildNsis(nsisOptions(inputs, seams.exec));
		return { ok: result.ok, text: describeNsis(result) };
	} catch (error) {
		return { ok: false, text: `crust package: ${format}: ${message(error)}` };
	}
}

export async function packageCommand(
	options: CliOptions,
	seams: PackageSeams = {},
): Promise<number> {
	const loaded = await loadConfig({ dir: options.dir, configPath: options.config });
	console.log(`crust package — ${loaded.path}`);
	const config = loaded.config;

	const bundle = await findAppBundle(options.dir);
	if (!bundle) {
		return fail(
			"package",
			`no .app in ${resolve(options.dir, "dist")} — run crust build first`,
		);
	}

	const configuredIcon = config.app.icon;
	const iconPath = configuredIcon ? resolve(options.dir, configuredIcon) : undefined;
	if (iconPath && !(await exists(iconPath))) {
		return fail(
			"package",
			`app.icon ${configuredIcon} does not exist (resolved to ${iconPath})`,
		);
	}

	line("bundle", bundle);
	const inputs: PackageInputs = {
		dir: options.dir,
		config,
		bundle,
		dist: dirname(bundle),
		iconPath,
	};

	let code = 0;
	for (const format of options.formats ?? ["dmg"]) {
		const outcome = await runFormat(format, inputs, seams);
		console.log(outcome.text);
		if (!outcome.ok) code = 1;
	}
	return code;
}
