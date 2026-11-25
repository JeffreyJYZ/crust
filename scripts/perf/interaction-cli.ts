/** CLI for the interaction-latency harness, split out to keep the driver small. */
import { resolve } from "node:path";
import { cac } from "cac";
import { runInteraction } from "./interaction.ts";

const root = resolve(import.meta.dir, "../..");

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
	const cli = cac("interaction");
	cli.command("measure", "run one interaction-latency probe")
		.option("--label <name>", "sample label", { default: "lat-core" })
		.option("--mode <name>", "core | paint | windows | launch", { default: "core" });
	const parsed = cli.parse(["bun", "interaction", ...argv], { run: false });

	if (argv[0] !== "measure") {
		cli.outputHelp();
		process.exitCode = 1;
		return;
	}
	const label = String(parsed.options.label ?? "lat-core");
	if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(label)) {
		console.log(`interaction: FAIL bad label ${label}`);
		process.exitCode = 1;
		return;
	}
	const out = resolve(root, "docs/reviews/perf/interaction", `${label}.json`);
	process.exitCode = await runInteraction(label, String(parsed.options.mode ?? "core"), out);
}

if (import.meta.main) await runCli();
