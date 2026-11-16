/**
 * Running a notarize plan and reading what notarytool answered. The argv lives in `notarize-plan.ts`, so what a test asserts is what this runs; `--wait` already returned the verdict, and an invalid one costs a second call to fetch the issues rather than a summary of them.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type RunResult, run } from "./exec";
import {
	buildNotarizePlan,
	CREDENTIAL_REQUIRES,
	type CredentialRoute,
	credentialFlags,
	credentialRoute,
	type NotarizeOptions,
	type NotarizeResult,
	type NotarizeStatus,
	refusal,
} from "./notarize-plan";

export * from "./notarize-plan.ts";

interface Submission {
	status?: NotarizeStatus;
	submissionId?: string;
	issues?: string[];
}

const STATUSES: Record<string, NotarizeStatus> = {
	accepted: "accepted",
	invalid: "invalid",
	rejected: "rejected",
};

/** notarytool prints one JSON object on stdout; a non-JSON exit keeps its own text as the log. */
function parseSubmission(result: RunResult): Submission {
	try {
		const json = JSON.parse(result.stdout.trim()) as {
			id?: unknown;
			status?: unknown;
			issues?: unknown;
		};
		const status = typeof json.status === "string" ? json.status.trim().toLowerCase() : "";
		return {
			status: STATUSES[status] ?? (status ? "rejected" : undefined),
			submissionId: typeof json.id === "string" ? json.id : undefined,
			issues: issueMessages(json.issues),
		};
	} catch {
		return {};
	}
}

/** Issues arrive as `{ message, … }` objects or plain strings; both keep their own words. */
function issueMessages(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const messages = value.flatMap((item) => {
		if (typeof item === "string") return [item];
		const message = (item as { message?: unknown } | null)?.message;
		return typeof message === "string" ? [message] : [];
	});
	return messages.length > 0 ? messages : undefined;
}

/**
 * The submit JSON carries the verdict and the id, not the issues: those live in `notarytool log <id>`. Without this call the user gets "invalid" and nothing to fix.
 */
async function collectIssues(
	exec: (command: string[]) => Promise<RunResult>,
	route: CredentialRoute,
	submitted: Submission,
	fallback: string,
): Promise<{ log?: string; issues?: string[] }> {
	if (!submitted.submissionId) return { log: fallback, issues: submitted.issues };

	const command = [
		"xcrun",
		"notarytool",
		"log",
		submitted.submissionId,
		...credentialFlags(route),
		"--output-format",
		"json",
	];
	const result = await exec(command);
	const text = (result.stdout || result.stderr).trim();
	try {
		const json = JSON.parse(text) as { issues?: unknown };
		return { log: text, issues: issueMessages(json.issues) ?? submitted.issues };
	} catch {
		return { log: text, issues: submitted.issues };
	}
}

/**
 * Zip, submit, staple, validate, ask Gatekeeper — in that order, because stapling a bundle Apple rejected fails with a message about a ticket rather than about the submission.
 */
export async function notarize(options: NotarizeOptions): Promise<NotarizeResult> {
	const blocked = refusal(options);
	const route = credentialRoute(options);
	if (blocked || !route) {
		return {
			ok: false,
			appPath: options.appPath,
			reason: blocked?.reason ?? "no notarytool credential",
			requires: blocked?.requires ?? CREDENTIAL_REQUIRES,
		};
	}

	const exec = options.exec ?? run;
	const dir = await mkdtemp(join(tmpdir(), "crust-notarize-"));
	try {
		const plan = buildNotarizePlan(options, join(dir, `${basename(options.appPath)}.zip`));
		let submissionId: string | undefined;

		for (const step of plan.steps) {
			const result = await exec(step.command);
			if (step.name === "submit") {
				const submitted = parseSubmission(result);
				submissionId = submitted.submissionId;
				if (submitted.status === "accepted") continue;
				const collected = await collectIssues(
					exec,
					route,
					submitted,
					(result.stdout || result.stderr).trim(),
				);
				return {
					ok: false,
					status: submitted.status ?? "rejected",
					appPath: options.appPath,
					submissionId,
					log: collected.log,
					issues: collected.issues,
				};
			}
			if (result.code !== 0) {
				return {
					ok: false,
					status: "rejected",
					appPath: options.appPath,
					reason: `${step.name} failed (exit ${result.code})`,
					submissionId,
					log: (result.stderr || result.stdout).trim(),
				};
			}
		}

		return { ok: true, status: "accepted", appPath: options.appPath, submissionId };
	} finally {
		// The zip is a second copy of the whole bundle; leaving it behind doubles the disk cost of every notarization.
		await rm(dir, { recursive: true, force: true });
	}
}
