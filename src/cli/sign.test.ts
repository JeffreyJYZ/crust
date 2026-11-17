import { describe, expect, test } from "bun:test";
import type { SignResult } from "@/packaging/sign";
import { signVerdict } from "./sign";

const DEVELOPER_ID: SignResult = {
	appPath: "/tmp/dist/Crust.app",
	mode: "developer-id",
	identity: "Developer ID Application: Crust (ABCDE12345)",
	hardenedRuntime: true,
	entitled: true,
};

describe("signVerdict", () => {
	test("uses the shared honest verdict, so a Developer ID sign cannot drift from it", () => {
		const lines = signVerdict(DEVELOPER_ID);
		expect(lines.some((text) => text.includes("signed /tmp/dist/Crust.app"))).toBe(true);
		expect(lines.some((text) => text.includes("+ hardened runtime"))).toBe(true);
		expect(lines.some((text) => text.includes("allow-jit"))).toBe(true);
		expect(lines.some((text) => text.includes("notarize not run"))).toBe(true);
	});

	test("keeps the ad-hoc Gatekeeper refusal the sign module promises", () => {
		const lines = signVerdict({ ...DEVELOPER_ID, mode: "adhoc", entitled: false });
		expect(lines.some((text) => text.includes("spctl rejects this bundle (exit 3)"))).toBe(
			true,
		);
		expect(lines.some((text) => text.includes("Developer ID Application certificate"))).toBe(
			true,
		);
	});
});
