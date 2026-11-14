/**
 * What every doctor check produces: one line, one status, no exceptions.
 */

export type Status = "ok" | "fail" | "note";

export interface Check {
	name: string;
	status: Status;
	detail: string;
}

export async function shellOutput(command: string[]): Promise<string | undefined> {
	try {
		const child = Bun.spawn({ cmd: command, stdout: "pipe", stderr: "pipe" });
		const text = await new Response(child.stdout).text();
		await child.exited;
		return text.trim();
	} catch {
		return undefined;
	}
}

/** Every check prints one line, so a multi-line compiler error is joined. */
export function inline(text: string): string {
	return text.replaceAll("\n", " | ");
}

/** Compare dotted version strings numerically, e.g. "13.0" against "14.1.2". */
export function versionAtLeast(version: string, minimum: string): boolean {
	const a = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const b = minimum.split(".").map((part) => Number.parseInt(part, 10) || 0);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const left = a[index] ?? 0;
		const right = b[index] ?? 0;
		if (left !== right) return left > right;
	}
	return true;
}
