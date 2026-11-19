/**
 * The fullscreen fix as an invariant rather than a literal: a window can only enter real macOS
 * fullscreen when its collection behaviour carries `fullScreenPrimary` and not
 * `fullScreenAuxiliary`. The auxiliary bit (256) is what made the green button a zoom `+`, so that
 * assertion is the one that would have caught the shipped bug; the control at the bottom proves the
 * check can still see it, which a test that merely restated the constant could not.
 */
import { describe, expect, test } from "bun:test";
import { collectionBehavior } from "./window-create.ts";

const CAN_JOIN_ALL_SPACES = 1;
const MOVE_TO_ACTIVE_SPACE = 2;
const FULL_SCREEN_PRIMARY = 128;
const FULL_SCREEN_AUXILIARY = 256;

describe("the window's collection behaviour", () => {
	const behavior = collectionBehavior();

	test("is fullscreen-primary", () => {
		expect(behavior & FULL_SCREEN_PRIMARY).toBe(FULL_SCREEN_PRIMARY);
	});

	test("is not a fullscreen auxiliary, the bit that turned the green button into a zoom", () => {
		expect(behavior & FULL_SCREEN_AUXILIARY).toBe(0);
	});

	test("does not claim every Space, which contradicts a fullscreen transition", () => {
		expect(behavior & CAN_JOIN_ALL_SPACES).toBe(0);
	});

	test("moves to the active Space on activation, the recorded launch behaviour", () => {
		expect(behavior & MOVE_TO_ACTIVE_SPACE).toBe(MOVE_TO_ACTIVE_SPACE);
	});

	test("the control: the shipped 257 fails the auxiliary check", () => {
		expect(257 & FULL_SCREEN_AUXILIARY).toBe(FULL_SCREEN_AUXILIARY);
	});
});
