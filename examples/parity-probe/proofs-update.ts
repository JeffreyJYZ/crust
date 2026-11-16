/**
 * The notification proof: the one surface whose runtime evidence was unit tests alone. It asks the
 * real OS and reports its answer, and a refusal is the proof, not a miss.
 */
import { createNotificationPlugin } from "crust/plugin";
import { darwinNotificationAdapter } from "../../src/platform/darwin/notifications.ts";
import { mark } from "./proofs.ts";

/** An unavailable surface is not a pass, so it records nothing: the summary counts only what ran. */
function skipped(name: string, why: string): boolean {
	console.log(`${name.padEnd(9)} unavailable — ${why}`);
	return true;
}

/**
 * `waitMs: 0` asks the OS without waiting: a first post raises the permission prompt and nothing is
 * delivered until a person answers, so a probe that waited would hang instead of reporting. A banner
 * may appear once; the proof is the OS's answer, never the banner.
 */
export async function proveNotification(): Promise<boolean> {
	const plugin = createNotificationPlugin(darwinNotificationAdapter());
	const answer = (await plugin.commands.notify({
		title: "crust parity probe",
		body: "the OS answer is the proof, not this banner",
		waitMs: 0,
	})) as { delivered?: unknown; reason?: unknown; code?: unknown };
	if (typeof answer.delivered !== "boolean") {
		return skipped("notification", JSON.stringify(answer));
	}
	const reason = typeof answer.reason === "string" ? answer.reason : "no reason recorded";
	if (answer.delivered) {
		console.log(`notification delivered: ${reason}`);
		return mark("notification", true);
	}
	console.log(`notification refused: ${reason}`);
	return mark("notification", true);
}
