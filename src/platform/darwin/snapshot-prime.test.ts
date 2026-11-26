/**
 * The harness-only composited-bit override, proven without WebKit: a recording shim shows the set,
 * the send and the restore in order on every terminal path. An ordinary capture must not touch the
 * private selector at all, and an absent selector must refuse by name before any send. The real
 * pixels and the native restore live in `snapshot-prime-live.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { primeOwner } from "./occlusion.ts";
import {
	PRIME_UNAVAILABLE,
	SNAPSHOT_STATUS,
	type SnapshotBytes,
	type SnapshotShim,
	takeSnapshot,
} from "@/platform/darwin/snapshot.ts";

const PICTURE: SnapshotBytes = {
	width: 960,
	height: 640,
	scale: 2,
	flat: false,
	png: new Uint8Array([1, 2, 3]),
};

/** Records `on`, `take`, `off` in the order AppKit would see them. */
function recording(
	options: {
		when?: "after" | "never";
		answer?: boolean;
		status?: number;
		selector?: boolean;
	} = {},
): SnapshotShim & { calls: string[] } {
	const when = options.when ?? "after";
	const selector = options.selector ?? true;
	const seam = {
		calls: [] as string[],
		channel: undefined as ((id: number, ok: boolean) => void) | undefined,
		available: () => true,
		take(_view: number, id: number) {
			seam.calls.push("take");
			if (when === "after") queueMicrotask(() => seam.channel?.(id, options.answer ?? true));
			return options.status ?? SNAPSHOT_STATUS.started;
		},
		read: () => PICTURE,
		setChannel(onAnswer: (id: number, ok: boolean) => void) {
			seam.channel = onAnswer;
		},
		primeAvailable: () => selector,
		prime(_view: number, enabled: boolean) {
			seam.calls.push(enabled ? "on" : "off");
			return selector;
		},
		composited: () => selector,
	};
	return seam;
}

describe("window.capture prime (harness only)", () => {
	test("an ordinary capture never touches the composited bit", async () => {
		const seam = recording();
		await takeSnapshot(1, seam);
		expect(seam.calls).toEqual(["take"]);
	});

	test("prime: false is the same ordinary capture", async () => {
		const seam = recording();
		await takeSnapshot(1, seam, 1000, { prime: false });
		expect(seam.calls).toEqual(["take"]);
	});

	test("prime sets the bit before the send and restores after the picture", async () => {
		const seam = recording();
		const shot = await takeSnapshot(1, seam, 1000, { prime: true });
		expect(shot.width).toBe(960);
		expect(seam.calls).toEqual(["on", "take", "off"]);
	});

	test("a refused render still restores the bit", async () => {
		const seam = recording({ answer: false });
		await expect(takeSnapshot(1, seam, 1000, { prime: true })).rejects.toThrow(
			"rendered nothing",
		);
		expect(seam.calls).toEqual(["on", "take", "off"]);
	});

	test("a timeout still restores the bit", async () => {
		const seam = recording({ when: "never" });
		await expect(takeSnapshot(1, seam, 20, { prime: true })).rejects.toThrow(
			"no composited picture",
		);
		expect(seam.calls).toEqual(["on", "take", "off"]);
	});

	test("a capture that never starts still restores the bit", async () => {
		const seam = recording({ status: SNAPSHOT_STATUS.noConfig });
		await expect(takeSnapshot(1, seam, 1000, { prime: true })).rejects.toThrow(
			"WKSnapshotConfiguration did not build",
		);
		expect(seam.calls).toEqual(["on", "take", "off"]);
	});

	test("a channel that fails to install still restores the bit", async () => {
		const seam = recording();
		seam.setChannel = () => {
			throw new Error("channel broke");
		};
		await expect(takeSnapshot(1, seam, 1000, { prime: true })).rejects.toThrow("channel broke");
		expect(seam.calls).toEqual(["on", "off"]);
	});

	test("a superseded capture restores before the next one sets again", async () => {
		const seam = recording({ when: "never" });
		const first = takeSnapshot(1, seam, 1000, { prime: true });
		const second = takeSnapshot(2, seam, 20, { prime: true });
		await expect(first).rejects.toThrow("superseded this one");
		await expect(second).rejects.toThrow("no composited picture");
		expect(seam.calls).toEqual(["on", "take", "off", "on", "take", "off"]);
	});

	test("a missing selector refuses by name before any send", async () => {
		const seam = recording({ selector: false });
		await expect(takeSnapshot(1, seam, 1000, { prime: true })).rejects.toThrow(
			PRIME_UNAVAILABLE,
		);
		expect(seam.calls).toEqual([]);
	});

	test("a production bundle refuses prime before anything is sent", async () => {
		const saved = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const seam = recording();
			await expect(takeSnapshot(1, seam, 1000, { prime: true })).rejects.toThrow(
				PRIME_UNAVAILABLE,
			);
			expect(seam.calls).toEqual([]);
		} finally {
			if (saved === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = saved;
		}
	});

	test("a shim without the private seam refuses by name instead of ignoring the option", async () => {
		const seam = recording();
		delete seam.prime;
		await expect(takeSnapshot(1, seam, 1000, { prime: true })).rejects.toThrow(
			PRIME_UNAVAILABLE,
		);
		expect(seam.calls).toEqual([]);
	});

	test("prime sets the bit before the composited fact is read, and a flat picture stays a picture", async () => {
		let bit = 0;
		const flatPicture = { ...PICTURE, flat: true };
		const seam: SnapshotShim = {
			...recording(),
			prime: (_view, enabled) => {
				bit = enabled ? 1 : 0;
				return true;
			},
			composited: () => bit === 1,
			read: () => flatPicture,
		};

		const shot = await takeSnapshot(1, seam, 1000, { prime: true });
		expect(shot.composited).toBe(true);
		expect(shot.flat).toBe(true);
		// The read happened before `done()` restored the bit, so the fact survives the restore.
		expect(bit).toBe(0);
	});

	test("a second holder keeps the bit set until the last one lets go", async () => {
		const view = 9182;
		const holder = Symbol("another probe");
		const sends: string[] = [];
		expect(
			primeOwner.acquire(view, holder, (_target, enabled) => {
				sends.push(enabled ? "on" : "off");
				return true;
			}),
		).toBe(true);
		try {
			const seam = recording();
			const shot = await takeSnapshot(view, seam, 1000, { prime: true });
			expect(shot.scale).toBe(2);
			// The other probe already set it, so this capture sends nothing and restores nothing.
			expect(seam.calls).toEqual(["take"]);
			expect(sends).toEqual(["off"]);
			expect(primeOwner.holds(view)).toBe(1);
		} finally {
			primeOwner.release(view, holder);
		}
		expect(sends).toEqual(["off", "on"]);
		expect(primeOwner.holds(view)).toBe(0);
	});
});
