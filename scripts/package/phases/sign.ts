/**
 * Phase 4: `crust sign` refuses without a certificate — and the refusal is the
 * feature, so its wording is asserted as well as its exit code.
 */
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine } from "../../lib/text.ts";
import { CLI, listDist, note, REPO_ROOT, sha256 } from "../fixture.ts";
import type { Built } from "./build.ts";

export async function signPhase(verdict: Verdict, scratch: string, built: Built): Promise<void> {
	// The refusal path is only reachable with the variable unset, so the run sets
	// that up itself. It is restored afterwards and never printed: it can name a
	// real certificate.
	const inherited = process.env.CRUST_SIGNING_IDENTITY;
	delete process.env.CRUST_SIGNING_IDENTITY;
	const binaryBefore = await sha256(built.binary);
	const distBefore = await listDist(built.dist);
	const signatureBefore = await runCommand(
		["codesign", "-dv", "--verbose=4", built.bundle],
		REPO_ROOT,
	);
	const signRun = await runCommand([CLI, "sign", "--dir", scratch], REPO_ROOT);
	if (inherited !== undefined) process.env.CRUST_SIGNING_IDENTITY = inherited;
	if (inherited !== undefined) {
		note("CRUST_SIGNING_IDENTITY was set in this shell; unset here so the refusal path runs");
	}

	verdict.check(
		"sign",
		signRun.code !== 0,
		signRun.code !== 0
			? `crust sign exited ${signRun.code} instead of signing something it cannot verify`
			: "crust sign exited 0 with no certificate — a signature nobody can notarize was claimed as success",
	);

	// The message is the feature: a user without a certificate needs to be told
	// what is missing and what to get. The exact text is printed, so a regression
	// in wording is visible in the log rather than only in a boolean.
	const refusal = (signRun.stderr || signRun.stdout).trim();
	const refusalLine = refusal.split("\n")[0]?.trim() ?? "";
	if (refusalLine.length > 0) note(`crust sign said: ${refusalLine}`);
	const namesVariable = refusal.includes("CRUST_SIGNING_IDENTITY");
	const namesWhatsMissing = /Developer ID/.test(refusal) && /certificate|identity/i.test(refusal);
	const namesConsequence = /Gatekeeper|ad-hoc|another machine/i.test(refusal);
	const singleLine = refusal.split("\n").length === 1 && refusal.length > 0;
	verdict.check(
		"sign message",
		singleLine && namesVariable && namesWhatsMissing && namesConsequence,
		singleLine && namesVariable && namesWhatsMissing && namesConsequence
			? "one line naming the variable, the Developer ID certificate and the Gatekeeper consequence"
			: !singleLine
				? `stderr is ${refusal.split("\n").length} lines, not one actionable line: ${refusalLine || "(empty)"}`
				: `the refusal never names ${[
						namesVariable ? "" : "CRUST_SIGNING_IDENTITY",
						namesWhatsMissing ? "" : "the missing certificate",
						namesConsequence ? "" : "what Gatekeeper does about it",
					]
						.filter((part) => part.length > 0)
						.join(", ")} — a user cannot act on it`,
	);

	// A command that fails must not also claim it signed. Only `signed` is the
	// claim; the header line naming the config is not.
	verdict.check(
		"sign honest",
		!/^\s{2}signed\s/m.test(signRun.stdout),
		/^\s{2}signed\s/m.test(signRun.stdout)
			? `crust sign printed a signed line while exiting ${signRun.code}`
			: "stdout claims nothing about signing",
	);

	// The failure must be a refusal, not damage: same binary bytes, same files in
	// `dist`, so a user can go on building and signing elsewhere.
	const binaryAfter = await sha256(built.binary);
	const distAfter = await listDist(built.dist);
	const before = distBefore ?? [];
	const after = distAfter ?? [];
	const unchanged = binaryBefore !== "missing" && binaryAfter === binaryBefore;
	const filesSame =
		distBefore !== undefined &&
		distAfter !== undefined &&
		before.join("\n") === after.join("\n");
	verdict.check(
		"sign keeps",
		unchanged && filesSame,
		unchanged && filesSame
			? `binary ${binaryBefore.slice(0, 12)} and ${before.length} dist entries unchanged`
			: !unchanged
				? `the refused command changed the binary: ${binaryBefore.slice(0, 12)} -> ${binaryAfter.slice(0, 12)}`
				: `the refused command changed dist: ${before.join(", ")} -> ${after.join(", ")}`,
	);

	// The ad-hoc seal `crust build` made must still verify: a half-applied
	// signature would leave a bundle that no longer runs.
	const seal = await runCommand(["codesign", "--verify", "--strict", built.bundle], REPO_ROOT);
	const sealText = `${signatureBefore.stderr}${signatureBefore.stdout}`;
	const stillAdhoc = /^Signature=adhoc$/m.test(sealText);
	verdict.check(
		"sign seal",
		seal.code === 0 && stillAdhoc,
		seal.code === 0 && stillAdhoc
			? "codesign --verify --strict still passes and the signature is still adhoc"
			: seal.code !== 0
				? `codesign --verify --strict exited ${seal.code} — ${lastLine(seal.stderr) || lastLine(seal.stdout)}`
				: `the signature is no longer adhoc — ${lastLine(sealText)}`,
	);
}
