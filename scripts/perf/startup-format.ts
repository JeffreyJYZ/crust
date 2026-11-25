/** The page, the stacked table and the sample reader for the startup harness. */

/** Page-side anchors. `navAt` is the first authored script on the document. */
export const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>crust startup probe</title></head><body>
<script>
var a = { navAt: Date.now(), readyAt: null, firstRafAt: null };
window.addEventListener("load", function () { a.readyAt = Date.now(); }, { once: true });
requestAnimationFrame(function () { a.firstRafAt = Date.now(); });
requestAnimationFrame(function tick() { requestAnimationFrame(tick); });
(async function send() {
  while (window.crust === undefined || a.readyAt === null || a.firstRafAt === null) {
    await new Promise(function (done) { setTimeout(done, 5); });
  }
  await window.crust.ready;
  await window.crust.invoke("startup", "report", { json: JSON.stringify(a) });
})();
</script></body></html>
`;

/** The brief's six boundaries plus the scaffold-specific ones that are now visible. */
export const SEGMENTS = [
	["process start → first crust line", "processStart", "firstLine"],
	["module graph + CLI parse", "firstLine", "cliParsed"],
	["conditions snapshot (subprocesses)", "cliParsed", "conditionsDone"],
	["native shim cc compile", "conditionsDone", "nativeReady"],
	["platform.start()", "nativeReady", "platformStarted"],
	["bridge bind", "platformStarted", "bridgeReady"],
	["window + WKWebView create", "bridgeReady", "windowCreated"],
	["navigation → first page script", "windowCreated", "navAt"],
	["first page script → document complete", "navAt", "readyAt"],
	["document complete → first rAF", "readyAt", "firstRafAt"],
] as const;

export function stack(record: Record<string, number>): Array<[string, number]> {
	return SEGMENTS.map(([name, from, to]) => [name, (record[to] ?? 0) - (record[from] ?? 0)]);
}

interface Sample {
	label: string;
	mode?: string;
	marks: Record<string, number>;
	totalMs: number;
	conditions?: { contaminated?: boolean };
}

/** Print p50/p95 and one stacked table whose rows sum exactly to its total. */
export async function summarize(
	dir: string,
	readdir: () => Promise<string[]>,
	read: (path: string) => Promise<string>,
	mode = "page",
): Promise<number> {
	const names = (await readdir().catch(() => []))
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.replace(/\.json$/, ""))
		.sort();
	if (names.length === 0) {
		console.log("startup: no samples recorded");
		return 1;
	}
	const all = await Promise.all(
		names.map(async (name) => JSON.parse(await read(`${dir}/${name}.json`)) as Sample),
	);
	const records = all.filter((record) => (record.mode ?? "page") === mode);
	if (records.length === 0) {
		console.log(`startup: no ${mode} samples recorded`);
		return 1;
	}
	const totals = records.map((record) => record.totalMs).sort((a, b) => a - b);
	const middle = Math.floor(totals.length / 2);
	const median = records.find((record) => record.totalMs === totals[middle]);
	if (median === undefined) return 1;
	console.log(
		`n=${records.length}  p50=${totals[middle]}  ` +
			`p95=${totals[Math.min(totals.length - 1, Math.ceil(0.95 * totals.length) - 1)]}`,
	);
	for (const [name, ms] of stack(median.marks)) {
		console.log(`${name.padEnd(42)} ${String(ms).padStart(5)} ms`);
	}
	console.log(`${"TOTAL".padEnd(42)} ${String(median.totalMs).padStart(5)} ms`);
	console.log(
		`contaminated runs: ${records.filter((r) => r.conditions?.contaminated).length}/${records.length}`,
	);
	return 0;
}
