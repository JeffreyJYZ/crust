/**
 * Reading `logs/*.jsonl` back and asserting the facts the brief promises: every line is a JSON
 * object carrying the seven base fields, the run's own events are all there, the refused invoke
 * names its code and duration, rotation produced an archive, and no credential reached disk.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Verdict } from "../e2e-harness.ts";
import { PLANTED_SECRET } from "./fixture.ts";

/** The base fields every line carries, whatever its source. */
const BASE = ["ts", "level", "source", "event", "pid", "seq"] as const;

const LEVELS = new Set(["trace", "debug", "info", "warn", "error"]);

/** Credential shapes that must never reach a log line; the bridge mints a UUID as its token. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const QUERY_LEAK = /[?&](?:token|key|secret|password)=((?!\[redacted\])[^&#"'\s]+)/i;
const BEARER_LEAK = /\bBearer\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]{12,}/;

export type LogLine = Record<string, unknown>;

/** A line of the live file, with the reason it could not be parsed when that happened. */
interface Parsed {
	line: LogLine | undefined;
	raw: string;
}

async function readJsonl(path: string): Promise<string[]> {
	const text = await readFile(path, "utf8").catch(() => "");
	return text.split("\n").filter((line) => line.trim().length > 0);
}

/** A parsed line, or `undefined` with the raw line already in hand for the failure text. */
function parse(raw: string): Parsed {
	try {
		const value: unknown = JSON.parse(raw);
		return { line: value as LogLine, raw };
	} catch {
		return { line: undefined, raw };
	}
}

/** A string field, or a marker the failure message can print. */
function text(line: LogLine, key: string): string {
	const value = line[key];
	return typeof value === "string" ? value : `<no ${key}>`;
}

/** The line that recorded the refused `os.info` call, if one did. */
function refusal(lines: LogLine[]): LogLine | undefined {
	return lines.find(
		(line) =>
			text(line, "source") === "bridge" &&
			text(line, "event") === "bridge.invoke" &&
			line.ok === false &&
			text(line, "code") === "forbidden",
	);
}

/** Every `event` the run wrote, so a missing family reads by name. */
function events(lines: LogLine[]): string[] {
	return lines.map((line) => text(line, "event"));
}

/** `app.jsonl` and every rotated `app.N.jsonl`, oldest generation first. */
async function appFiles(logs: string): Promise<string[]> {
	const names = await readdir(logs).catch(() => [] as string[]);
	const generation = (name: string): number =>
		Number(name.match(/^app\.(\d+)\.jsonl$/)?.[1] ?? 0);
	const archived = names
		.filter((name) => /^app\.\d+\.jsonl$/.test(name))
		.sort((a, b) => generation(b) - generation(a));
	return [...archived.map((name) => join(logs, name)), join(logs, "app.jsonl")];
}

/** Assert everything the brief names, against the directory the app wrote. */
export async function checkLogs(verdict: Verdict, logs: string): Promise<void> {
	const live = join(logs, "app.jsonl");
	const rawLines = await readJsonl(live);

	// A rotating file moves the run's early lines into `app.1.jsonl`, so the run's record is the
	// whole chain; reading only the live file would call a complete log incomplete.
	const chain = await appFiles(logs);
	const everything = (await Promise.all(chain.map(readJsonl))).flat();
	const parsed = everything.map(parse);
	const lines = parsed.flatMap((entry) => (entry.line === undefined ? [] : [entry.line]));

	verdict.check(
		"live file",
		rawLines.length > 0,
		rawLines.length > 0
			? `${live} holds ${rawLines.length} lines, ${everything.length} across ${chain.length} file(s)`
			: `${live} is missing or empty`,
	);

	const broken = parsed.filter((entry) => entry.line === undefined);
	const malformed = lines.filter((line) => {
		if (typeof line.ts !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(line.ts)) return true;
		if (typeof line.level !== "string" || !LEVELS.has(line.level)) return true;
		if (typeof line.source !== "string" || line.source.length === 0) return true;
		if (typeof line.event !== "string" || line.event.length === 0) return true;
		if (typeof line.pid !== "number" || typeof line.seq !== "number") return true;
		return false;
	});
	verdict.check(
		"fields",
		lines.length > 0 && broken.length === 0 && malformed.length === 0,
		broken.length > 0
			? `${broken.length} line(s) are not JSON, first: ${broken[0]?.raw.slice(0, 80)}`
			: malformed.length > 0
				? `${malformed.length} line(s) lack ${BASE.join("/")}, first: ${JSON.stringify(malformed[0]).slice(0, 80)}`
				: `${lines.length} lines carry ${BASE.join("/")}`,
	);

	const seen = events(lines);
	const has = (test: (event: string) => boolean): boolean => seen.some(test);
	const families = [
		{ name: "app.*", ok: has((event) => event.startsWith("app.")) },
		{ name: "window.create", ok: seen.includes("window.create") },
		{ name: "window.close", ok: seen.includes("window.close") },
		{ name: "bridge.invoke", ok: seen.includes("bridge.invoke") },
		{ name: "page.console", ok: seen.includes("page.console") },
		{ name: "page.error", ok: has((event) => event.startsWith("page.error")) },
	];
	const missing = families.filter((family) => !family.ok).map((family) => family.name);
	verdict.check(
		"events",
		missing.length === 0,
		missing.length === 0
			? `${families.map((family) => family.name).join(", ")} all recorded`
			: `missing ${missing.join(", ")} of ${seen.length} events`,
	);

	const refused = refusal(lines);
	verdict.check(
		"forbidden",
		refused !== undefined && refused.ns === "os" && typeof refused.durMs === "number",
		refused === undefined
			? "no bridge.invoke line carries ok:false with code forbidden"
			: `os.info answered ${text(refused, "code")} in ${String(refused.durMs)} ms`,
	);

	const archive = join(logs, "app.1.jsonl");
	const archived = await readFile(archive, "utf8").catch(() => "");
	verdict.check(
		"rotation",
		archived.length > 0,
		archived.length > 0
			? `${archive} holds ${archived.split("\n").filter(Boolean).length} lines`
			: `${archive} never appeared, so the run never passed the configured maxBytes`,
	);

	const names = await readdir(logs).catch(() => [] as string[]);
	const files = names.filter((name) => name.endsWith(".jsonl"));
	const all = await Promise.all(files.map((name) => readFile(join(logs, name), "utf8")));
	const joined = all.join("\n");
	// The bridge mints a UUID, so a UUID anywhere is the document token leaking; the planted value
	// is the one the page put in a URL query, which redaction must scrub by shape.
	const problems = [
		UUID.test(joined) ? "a UUID-shaped bridge token appears" : undefined,
		joined.includes(PLANTED_SECRET) ? `${PLANTED_SECRET} appears` : undefined,
		QUERY_LEAK.test(joined) ? "a token/secret query value was not redacted" : undefined,
		BEARER_LEAK.test(joined) ? "a Bearer value was not redacted" : undefined,
	].filter((problem): problem is string => problem !== undefined);
	verdict.check(
		"secrets",
		problems.length === 0,
		problems.length === 0
			? `no token, Bearer value or ${PLANTED_SECRET} in ${files.length} file(s)`
			: problems.join("; "),
	);
}
