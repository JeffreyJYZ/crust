/**
 * Reading this proof's answers: the backend's live-window read, the page's own viewport beside the
 * display it sits on, and one fullscreen transition. Everything here is about a captured log.
 */
import { type PageAnswer, resolved } from "../window/answers.ts";

/** One `probe` answer: the live `NSWindow` as AppKit holds it. */
export interface ProbeReading {
	/** The probed window is the same one the launch read named. */
	found: boolean;
	/** `-[NSApplication isActive]` at the read: 1 or 0. */
	active: number;
	collectionBehavior: number;
	styleMask: number;
	fullscreen: boolean;
	onActiveSpace: number;
	windowNumber: number;
}

export interface Frame {
	width: number;
	height: number;
}

export interface Display extends Frame {
	availHeight: number;
}

/** The page's viewport beside the display it is on. */
export interface Screenful {
	viewport: Frame;
	screen: Display;
}

/** One transition: whether both halves agreed, and what the page saw when the poll stopped. */
export interface Transition {
	reached: boolean;
	settled: PageAnswer | undefined;
	viewport: Frame;
	screen: Display;
	elapsedMs: number;
}

function numberIn(bag: Record<string, unknown>, key: string): number | undefined {
	const value = bag[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function frameIn(value: unknown): Frame | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const bag = value as Record<string, unknown>;
	const width = numberIn(bag, "width");
	const height = numberIn(bag, "height");
	return width === undefined || height === undefined ? undefined : { width, height };
}

function displayIn(value: unknown): Display | undefined {
	const frame = frameIn(value);
	if (frame === undefined || typeof value !== "object" || value === null) return undefined;
	const availHeight = numberIn(value as Record<string, unknown>, "availHeight");
	return availHeight === undefined ? undefined : { ...frame, availHeight };
}

export function probeOf(answer: PageAnswer | undefined): ProbeReading | undefined {
	const bag = resolved(answer);
	if (bag === undefined) return undefined;
	const collectionBehavior = numberIn(bag, "collectionBehavior");
	const styleMask = numberIn(bag, "styleMask");
	const onActiveSpace = numberIn(bag, "onActiveSpace");
	if (collectionBehavior === undefined || styleMask === undefined) return undefined;
	if (onActiveSpace === undefined) return undefined;
	return {
		found: bag.found === true,
		active: numberIn(bag, "active") ?? -1,
		collectionBehavior,
		styleMask,
		fullscreen: bag.fullscreen === true,
		onActiveSpace,
		windowNumber: numberIn(bag, "windowNumber") ?? -1,
	};
}

export function screenfulOf(answer: PageAnswer | undefined): Screenful | undefined {
	const bag = resolved(answer);
	if (bag === undefined) return undefined;
	const viewport = frameIn(bag.viewport);
	const screen = displayIn(bag.screen);
	if (viewport === undefined || screen === undefined) return undefined;
	return { viewport, screen };
}

export function transitionOf(answer: PageAnswer | undefined): Transition | undefined {
	const bag = resolved(answer);
	if (bag === undefined) return undefined;
	const viewport = frameIn(bag.viewport);
	const screen = displayIn(bag.screen);
	if (viewport === undefined || screen === undefined) return undefined;
	const settled = bag.settled;
	return {
		reached: bag.reached === true,
		settled:
			typeof settled === "object" && settled !== null ? (settled as PageAnswer) : undefined,
		viewport,
		screen,
		elapsedMs: numberIn(bag, "elapsedMs") ?? -1,
	};
}

/** A fullscreen flag out of a `setFullscreen`/`isFullscreen` answer. */
export function fullscreenFlag(answer: PageAnswer | undefined): boolean | undefined {
	const bag = resolved(answer);
	const flag = bag?.fullscreen;
	return typeof flag === "boolean" ? flag : undefined;
}
