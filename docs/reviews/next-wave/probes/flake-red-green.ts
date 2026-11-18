/**
 * Red-then-green proof for the four sleep-as-synchronisation fixes in fix-wave-2/B8.
 * Each case schedules its own event at EVENT_MS, past the OLD fixed sleep (SLEEP_MS), so the old
 * pattern reads a half-finished world every time. The new pattern polls the same condition against
 * a deadline and succeeds. Run: bun docs/reviews/next-wave/probes/flake-red-green.ts
 */
import { waitFor } from "../../../../scripts/harness/wait.ts";

const SLEEP_MS = 10;
const EVENT_MS = 60;
const DEADLINE_MS = 500;

interface Case {
	name: string;
	old: () => boolean | number;
	green: () => Promise<unknown>;
}

const factories: Array<() => Case> = [
	() => {
		let answered = false;
		setTimeout(() => void (answered = true), EVENT_MS);
		return {
			name: "chunked-body refusal settles",
			old: () => answered,
			green: () => waitFor(() => answered || null, DEADLINE_MS, "refusal"),
		};
	},
	() => {
		let quits = 0;
		setTimeout(() => void (quits = 1), EVENT_MS);
		return {
			name: "window-all-closed quit fires",
			old: () => quits,
			green: () => waitFor(() => (quits >= 1 ? quits : null), DEADLINE_MS, "quit"),
		};
	},
	() => {
		let settled = 0;
		setTimeout(() => void (settled = 1), EVENT_MS);
		return {
			name: "deferred quit settles",
			old: () => settled,
			green: () => waitFor(() => (settled >= 1 ? settled : null), DEADLINE_MS, "settle"),
		};
	},
	() => {
		let ticks = 0;
		const timer = setInterval(() => void ticks++, 5);
		return {
			name: "pump reaches two ticks",
			old: () => ticks > 1,
			green: async () => {
				const value = await waitFor(() => (ticks > 1 ? ticks : null), DEADLINE_MS, "ticks");
				clearInterval(timer);
				return value;
			},
		};
	},
];

let red = 0;
let green = 0;
for (const factory of factories) {
	const entry = factory();
	// Old pattern: a fixed sleep, then one assertion on the state.
	await Bun.sleep(SLEEP_MS);
	const oldPassed = Boolean(entry.old());
	if (!oldPassed) red += 1;

	// New pattern: poll the condition until the deadline.
	let newValue: unknown;
	try {
		newValue = await entry.green();
	} catch {
		newValue = undefined;
	}
	const newPassed = newValue !== undefined && newValue !== null && newValue !== false;
	if (newPassed) green += 1;

	console.log(`${entry.name}: old=${oldPassed ? "GREEN" : "RED"} new=${newPassed ? "GREEN" : "RED"}`);
}
console.log(`SUMMARY old RED ${red}/4, new GREEN ${green}/4`);
process.exit(red === 4 && green === 4 ? 0 : 1);
