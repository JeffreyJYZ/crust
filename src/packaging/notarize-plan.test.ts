import { describe, expect, test } from "bun:test";
import { buildNotarizePlan, describeNotarize, preflightNotarize } from "./notarize-plan";
import type { NotarizeStepName } from "./notarize-plan";

const APP = "/tmp/dist/Crust.app";
const ZIP = "/tmp/dist/Crust.app.zip";
const IDENTITY = "Developer ID Application: Crust (ABCDE12345)";
const PROFILE = "crust-notary";
const APPLE = ["--apple-id", "a@b.c", "--password", "app-specific", "--team-id", "ABCDE12345"];
const SUBMIT = ["xcrun", "notarytool", "submit", ZIP];
const TAIL = ["--wait", "--output-format", "json"];
const NAMES: NotarizeStepName[] = ["zip", "submit", "staple", "validate", "spctl"];
const AFTER_SUBMIT = [
	["xcrun", "stapler", "staple", APP],
	["xcrun", "stapler", "validate", APP],
	["spctl", "-a", "-vvv", APP],
];
const ISSUES = [
	"The binary is not signed with a valid Developer ID certificate.",
	"The signature does not include a secure timestamp.",
];

describe("preflightNotarize", () => {
	test("refuses an ad-hoc identity with the certificate it needs, and never plans one", () => {
		for (const identity of ["-", "", "   "]) {
			expect(preflightNotarize({ appPath: APP, identity, profile: PROFILE })).toEqual({
				ok: false,
				reason: "ad-hoc identity cannot be notarized",
				requires: "a Developer ID Application certificate",
			});
		}
		expect(() => buildNotarizePlan({ appPath: APP, identity: "-", profile: PROFILE })).toThrow(
			"ad-hoc identity cannot be notarized",
		);
	});

	test("refuses a Developer ID with no credential, or a half appleId route", () => {
		expect(preflightNotarize({ appPath: APP, identity: IDENTITY })).toEqual({
			ok: false,
			reason: "no notarytool credential",
			requires: "notarytool store-credentials <profile> or appleId + password",
		});
		expect(preflightNotarize({ appPath: APP, identity: IDENTITY, appleId: "a@b.c" }).ok).toBe(
			false,
		);
	});

	test("accepts either complete route", () => {
		expect(preflightNotarize({ appPath: APP, identity: IDENTITY, profile: PROFILE })).toEqual({
			ok: true,
		});
		const appleId = { appleId: "a@b.c", password: "p", teamId: "T" };
		expect(preflightNotarize({ appPath: APP, identity: IDENTITY, ...appleId })).toEqual({
			ok: true,
		});
	});
});

describe("buildNotarizePlan", () => {
	test("is the exact argv list for a keychain profile", () => {
		const plan = buildNotarizePlan({ appPath: APP, identity: IDENTITY, profile: PROFILE }, ZIP);
		expect(plan.steps.map((step) => step.name)).toEqual(NAMES);
		expect(plan.steps.map((step) => step.command)).toEqual([
			["ditto", "-c", "-k", "--keepParent", APP, ZIP],
			[...SUBMIT, "--keychain-profile", PROFILE, ...TAIL],
			...AFTER_SUBMIT,
		]);
	});

	test("asks Gatekeeper to execute the .app, never to install a package", () => {
		// `-t install` assesses an installer package and rejects every valid .app
		// with exit 3; the default `-t execute` is the launch question users mean.
		const plan = buildNotarizePlan({ appPath: APP, identity: IDENTITY, profile: PROFILE }, ZIP);
		const spctl = plan.steps.find((step) => step.name === "spctl");
		expect(spctl?.command).toEqual(["spctl", "-a", "-vvv", APP]);
		expect(spctl?.command).not.toContain("install");
	});

	test("swaps the profile for the one-shot appleId flags", () => {
		const appleId = { appleId: "a@b.c", password: "app-specific", teamId: "ABCDE12345" };
		const plan = buildNotarizePlan({ appPath: APP, identity: IDENTITY, ...appleId }, ZIP);
		expect(plan.steps[1]?.command).toEqual([...SUBMIT, ...APPLE, ...TAIL]);
	});
});

describe("describeNotarize", () => {
	test("names the status and id, and prints a refusal with what it requires", () => {
		expect(
			describeNotarize({ ok: true, status: "accepted", appPath: APP, submissionId: "sub-1" }),
		).toBe(`notarize accepted   sub-1  ${APP}`);
		expect(
			describeNotarize({
				ok: false,
				appPath: APP,
				reason: "ad-hoc identity cannot be notarized",
				requires: "a Developer ID Application certificate",
			}),
		).toBe(
			"notarize refused   ad-hoc identity cannot be notarized — requires a Developer ID Application certificate",
		);
	});

	test("adds each issue on its own line", () => {
		const text = describeNotarize({
			ok: false,
			status: "invalid",
			appPath: APP,
			issues: ISSUES,
		});
		expect(text.split("\n")).toEqual([
			`notarize invalid    ${APP}`,
			`  ${ISSUES[0]}`,
			`  ${ISSUES[1]}`,
		]);
	});
});
