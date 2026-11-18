/**
 * Fails when a JUnit XML report contains a skipped test that is not explicitly
 * allowlisted. `bun test` exits 0 for skips, so CI cannot tell a skip from a
 * pass by exit code; this script restores that signal.
 *
 * Usage: bun scripts/check-skips.ts <junit-report.xml>
 *
 * The report is deleted after it is read, because it is a throwaway produced
 * by the `test:no-skips` package script.
 */

// The only skipped test names that are sanctioned. Add a name here only when
// the skip has a documented justification (see docs/agents/check-skips.md).
// An empty allowlist means every skip fails the check.
const ALLOWLIST = new Set<string>([]);

const DEFAULT_REPORT = ".junit-skips.xml";

function decodeEntities(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#([0-9]+);/g, (_, dec: string) =>
			String.fromCodePoint(Number.parseInt(dec, 10)),
		);
}

function nameOf(attributes: string): string | undefined {
	const match = attributes.match(/\bname=['"]([^'"]*)['"]/);
	return match ? decodeEntities(match[1] ?? "") : undefined;
}

export function skippedNames(xml: string): string[] {
	const names: string[] = [];
	// Require a non-slash before `>` so self-closing `<testcase/>` tags are
	// skipped; otherwise one would swallow the next test's closing tag.
	const testcase = /<testcase\b([^>]*[^\/>])>([\s\S]*?)<\/testcase>/g;
	let match: RegExpExecArray | null;
	while ((match = testcase.exec(xml)) !== null) {
		if (/<skipped\b/.test(match[2] ?? "")) {
			const name = nameOf(match[1] ?? "");
			if (name !== undefined) names.push(name);
		}
	}
	return names;
}

async function main(): Promise<number> {
	const file = process.argv[2] ?? DEFAULT_REPORT;
	let xml: string;
	try {
		xml = await Bun.file(file).text();
	} catch (error) {
		console.error(`check-skips: cannot read report ${file}: ${String(error)}`);
		return 1;
	}

	const offenders = skippedNames(xml).filter((name) => !ALLOWLIST.has(name));
	for (const name of offenders) console.log(`skipped test: ${name}`);

	// The report is a temporary artifact of the package script.
	try {
		const { rmSync } = await import("node:fs");
		rmSync(file, { force: true });
	} catch {
		// Leave cleanup failures alone; the verdict is what matters.
	}

	if (offenders.length > 0) {
		console.error(
			`check-skips: ${offenders.length} skipped test(s) not in allowlist`,
		);
		return 1;
	}
	console.log("check-skips: no unapproved skips");
	return 0;
}

if (import.meta.main) process.exit(await main());
