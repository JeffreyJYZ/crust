/**
 * Small shared forms for a verdict detail: a bit pattern as hex, an unusable answer as the reason,
 * and the live-window read on one line.
 */
import { type PageAnswer, show } from "../../window/answers.ts";
import type { ProbeReading } from "../answers.ts";

export function bits(value: number): string {
	return `0x${value.toString(16)}`;
}

export function readOf(answer: PageAnswer | undefined, name: string): string {
	return `the ${name} read answered ${show(answer)}`;
}

/** The live-window read, with every number the assertions turn on. */
export function probeDetail(reading: ProbeReading, name: string): string {
	return (
		`${name}: collectionBehavior ${reading.collectionBehavior} (${bits(reading.collectionBehavior)}), ` +
		`styleMask ${reading.styleMask} (${bits(reading.styleMask)}), ` +
		`onActiveSpace ${reading.onActiveSpace}, app active ${reading.active}, ` +
		`window ${reading.windowNumber}`
	);
}
