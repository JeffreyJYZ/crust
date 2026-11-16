import { describe, expect, test } from "bun:test";
import type { RunResult } from "./exec";
import { notarize } from "./notarize";

const APP = "/tmp/dist/Crust.app";
const IDENTITY = "Developer ID Application: Crust (ABCDE12345)";
const PROFILE = "crust-notary";
const ISSUES = [
	"The binary is not signed with a valid Developer ID certificate.",
	"The signature does not include a secure timestamp.",
];
const INVALID_SUBMIT = { stdout: JSON.stringify({ id: "sub-1", status: "Invalid" }) };
const INVALID_LOG = {
	stdout: JSON.stringify({
		issues: ISSUES.map((message) => ({
			path: "Crust.app/Contents/MacOS/crust",
			severity: "error",
			message,
		})),
	}),
};
const UNAUTHORIZED = "Error: HTTP status code: 401";

function keyOf(command: string[]): string {
	return command[0] === "xcrun" ? `${command[1]} ${command[2]}` : (command[0] ?? "");
}

/** One fake for the whole plan: it records argv and answers by tool, never by position. */
function recorder(answers: Record<string, Partial<RunResult>> = {}) {
	const calls: string[][] = [];
	const exec = async (command: string[]): Promise<RunResult> => {
		calls.push(command);
		const answer = answers[keyOf(command)] ?? {};
		return { code: answer.code ?? 0, stdout: answer.stdout ?? "", stderr: answer.stderr ?? "" };
	};
	return { calls, exec };
}

const stapled = (calls: string[][]) => calls.some((command) => command[1] === "stapler");

describe("notarize", () => {
	test("runs no command when the identity is ad-hoc or no credential is supplied", async () => {
		const adhoc = recorder();
		const refused = await notarize({
			appPath: APP,
			identity: "-",
			profile: PROFILE,
			exec: adhoc.exec,
		});
		expect(adhoc.calls).toEqual([]);
		expect(refused.reason).toBe("ad-hoc identity cannot be notarized");
		expect(refused.requires).toBe("a Developer ID Application certificate");

		const bare = recorder();
		const uncredentialed = await notarize({
			appPath: APP,
			identity: IDENTITY,
			exec: bare.exec,
		});
		expect(bare.calls).toEqual([]);
		expect(uncredentialed.requires).toBe(
			"notarytool store-credentials <profile> or appleId + password",
		);
	});

	test("runs the whole plan in order and staples the app", async () => {
		const fake = recorder({
			"notarytool submit": { stdout: JSON.stringify({ id: "sub-1", status: "Accepted" }) },
		});
		const result = await notarize({
			appPath: APP,
			identity: IDENTITY,
			profile: PROFILE,
			exec: fake.exec,
		});
		expect(result).toMatchObject({ ok: true, status: "accepted", submissionId: "sub-1" });
		expect(fake.calls.map(keyOf)).toEqual([
			"ditto",
			"notarytool submit",
			"stapler staple",
			"stapler validate",
			"spctl",
		]);
	});

	test("surfaces notarytool's issues verbatim and never staples", async () => {
		const fake = recorder({
			"notarytool submit": INVALID_SUBMIT,
			"notarytool log": INVALID_LOG,
		});
		const result = await notarize({
			appPath: APP,
			identity: IDENTITY,
			profile: PROFILE,
			exec: fake.exec,
		});
		expect(result).toMatchObject({ ok: false, status: "invalid", submissionId: "sub-1" });
		expect(result.issues).toEqual(ISSUES);
		expect(fake.calls.map(keyOf)).toEqual(["ditto", "notarytool submit", "notarytool log"]);
		expect(stapled(fake.calls)).toBe(false);
	});

	test("never staples when the submit never got a verdict", async () => {
		const fake = recorder({ "notarytool submit": { code: 1, stderr: UNAUTHORIZED } });
		const result = await notarize({
			appPath: APP,
			identity: IDENTITY,
			profile: PROFILE,
			exec: fake.exec,
		});
		expect(result).toMatchObject({ ok: false, status: "rejected", log: UNAUTHORIZED });
		expect(stapled(fake.calls)).toBe(false);
	});

	test("reads a rejected verdict as rejected, not accepted", async () => {
		const fake = recorder({
			"notarytool submit": { stdout: JSON.stringify({ id: "sub-2", status: "Rejected" }) },
		});
		const result = await notarize({
			appPath: APP,
			identity: IDENTITY,
			profile: PROFILE,
			exec: fake.exec,
		});
		expect(result).toMatchObject({ ok: false, status: "rejected", submissionId: "sub-2" });
		expect(stapled(fake.calls)).toBe(false);
	});
});
