import { run } from "./exec";

export interface VerifyResult {
	valid: boolean;
	exitCode: number;
	output: string;
}

export interface GatekeeperResult {
	accepted: boolean;
	exitCode: number;
	raw: string;
}

/**
 * The argv `crust sign` claims it ran. `--strict` is what makes the claim true:
 * without it a bundle with strict-only issues is still reported as clean.
 */
export function verifyCommand(appPath: string): string[] {
	return ["codesign", "--verify", "--strict", "--verbose=4", appPath];
}

/** `codesign --verify --strict` — cheap, local, no Gatekeeper, no network. */
export async function verifySignature(appPath: string): Promise<VerifyResult> {
	const result = await run(verifyCommand(appPath));
	return {
		valid: result.code === 0,
		exitCode: result.code,
		output: (result.stderr || result.stdout).trim(),
	};
}

/**
 * `codesign -dv` — read the signature without validating every sealed file.
 *
 * This is the cheap half of verification and the one to use in a loop or in CI
 * where a full `--verify` plus `spctl` pair costs real time per artefact.
 */
export async function describeSignature(appPath: string): Promise<string> {
	const result = await run(["codesign", "-dv", "--verbose=4", appPath]);
	return (result.stderr || result.stdout).trim();
}

/**
 * Ask Gatekeeper. Expensive, and the answer is already known for ad-hoc — included because `crust sign` must tell the user the truth about their own signature and a Developer ID build answers differently. Once per artefact, never per check.
 */
export async function assessGatekeeper(appPath: string): Promise<GatekeeperResult> {
	const result = await run(["spctl", "-a", "-vvv", appPath]);
	return {
		accepted: result.code === 0,
		exitCode: result.code,
		raw: (result.stderr || result.stdout).trim(),
	};
}
