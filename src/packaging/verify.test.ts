import { describe, expect, test } from "bun:test";
import { verifyCommand } from "./verify";

const APP = "/tmp/dist/Crust.app";

describe("verifyCommand", () => {
	test("runs the strict, deep form the CLI claims passed", () => {
		// `crust sign` prints "codesign --verify --strict --deep passed". Without --deep
		// nested sidecars get only a shallow investigation and ad-hoc ones read as clean.
		const argv = verifyCommand(APP);
		expect(argv).toEqual(["codesign", "--verify", "--strict", "--deep", "--verbose=4", APP]);
		expect(argv).toContain("--strict");
		expect(argv).toContain("--deep");
	});
});
