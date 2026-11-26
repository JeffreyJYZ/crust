/**
 * The opt-in's seam, proven without WebKit: a shim records every private-SPI send so the order and
 * the restore are assertions, not claims. An ordinary capture must not touch the flag at all —
 * that is the product default staying exactly as it was. The real off-screen picture is proved in
 * `snapshot-occlusion-live.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { occlusionOwner } from "./occlusion.ts";
import {
	OCCLUSION_UNAVAILABLE,
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

/** Records `off`, `take`, `on` in the order WebKit would see them. */
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
		occlusion(_view: number, enabled: boolean) {
			seam.calls.push(enabled ? "on" : "off");
			return selector;
		},
	};
	return seam;
}

describe("window.capture ignoreOcclusion", () => {
	test("the composited bit and flatness reach the caller as capture-time facts", async () => {
		const flatPicture = { ...PICTURE, flat: true };
		const seam: SnapshotShim = {
			...recording(),
			composited: () => false,
			read: () => flatPicture,
		};

		const shot = await takeSnapshot(1, seam);
		expect(shot.composited).toBe(false);
		expect(shot.flat).toBe(true);
	});

	test("an ordinary capture never touches WebKit's occlusion flag", async () => {
		const seam = recording();
		await takeSnapshot(1, seam);
		expect(seam.calls).toEqual(["take"]);
		expect(seam.calls).not.toContain("off");
	});

	test("ignoreOcclusion: false is the same ordinary capture", async () => {
		const seam = recording();
		await takeSnapshot(1, seam, 1000, { ignoreOcclusion: false });
		expect(seam.calls).toEqual(["take"]);
	});

	test("the override is disabled before the send and restored after the picture", async () => {
		const seam = recording();
		const shot = await takeSnapshot(1, seam, 1000, { ignoreOcclusion: true });
		expect(shot.scale).toBe(2);
		expect(seam.calls).toEqual(["off", "take", "on"]);
	});

	test("a refused render still restores the flag", async () => {
		const seam = recording({ answer: false });
		const failing = takeSnapshot(1, seam, 1000, { ignoreOcclusion: true });
		await expect(failing).rejects.toThrow("rendered nothing");
		expect(seam.calls).toEqual(["off", "take", "on"]);
	});

	test("a timeout still restores the flag", async () => {
		const seam = recording({ when: "never" });
		await expect(takeSnapshot(1, seam, 20, { ignoreOcclusion: true })).rejects.toThrow(
			"never called the snapshot completion handler",
		);
		expect(seam.calls).toEqual(["off", "take", "on"]);
	});

	test("a capture that never starts still restores the flag", async () => {
		const seam = recording({ status: SNAPSHOT_STATUS.noConfig });
		await expect(takeSnapshot(1, seam, 1000, { ignoreOcclusion: true })).rejects.toThrow(
			"WKSnapshotConfiguration did not build",
		);
		expect(seam.calls).toEqual(["off", "take", "on"]);
	});

	test("a superseded capture restores before the next one disables again", async () => {
		const seam = recording({ when: "never" });
		const first = takeSnapshot(1, seam, 1000, { ignoreOcclusion: true });
		const second = takeSnapshot(2, seam, 20, { ignoreOcclusion: true });
		await expect(first).rejects.toThrow("superseded this one");
		await expect(second).rejects.toThrow("never called the snapshot completion handler");
		expect(seam.calls).toEqual(["off", "take", "on", "off", "take", "on"]);
	});

	test("a channel that fails to install still restores the flag", async () => {
		const seam = recording();
		seam.setChannel = () => {
			throw new Error("channel broke");
		};
		await expect(takeSnapshot(1, seam, 1000, { ignoreOcclusion: true })).rejects.toThrow(
			"channel broke",
		);
		expect(seam.calls).toEqual(["off", "on"]);
	});

	/**
	 * The cross-feature proof: a perf run holds the override on this webview, and the live testing
	 * proof takes a second holder before first visibility. A capture between them must not turn
	 * detection back on, or every frame after it is scored against a suspended renderer. The perf
	 * sender is the only one that sees an `on`, and only when the last holder releases.
	 */
	test("a capture inside a perf-style override leaves detection disabled afterwards", async () => {
		const perfHolder = Symbol("perf-style holder");
		const liveHolder = Symbol("live testing holder");
		const perfSends: string[] = [];
		const view = 4242;
		const send = (target: number, enabled: boolean): boolean => {
			perfSends.push(enabled ? "on" : "off");
			expect(target).toBe(view);
			return true;
		};
		expect(occlusionOwner.acquire(view, perfHolder, send)).toBe(true);
		try {
			expect(occlusionOwner.acquire(view, liveHolder, send)).toBe(true);
			try {
				// The live proof re-asserts at first visibility: the disable is sent again, but the
				// holder count does not change.
				occlusionOwner.reassert(view);
				expect(perfSends).toEqual(["off", "off"]);
				const seam = recording();
				const shot = await takeSnapshot(view, seam, 1000, { ignoreOcclusion: true });
				expect(shot.scale).toBe(2);
				// Detection was already off, so the capture sends nothing at all, not even a restore.
				expect(seam.calls).toEqual(["take"]);
				expect(perfSends).toEqual(["off", "off"]);
				expect(occlusionOwner.holds(view)).toBe(2);
			} finally {
				occlusionOwner.release(view, liveHolder);
			}
			expect(perfSends).toEqual(["off", "off"]);
			expect(occlusionOwner.holds(view)).toBe(1);
		} finally {
			occlusionOwner.release(view, perfHolder);
		}
		expect(perfSends).toEqual(["off", "off", "on"]);
		expect(occlusionOwner.holds(view)).toBe(0);
	});

	test("an absent private selector refuses by name before any send", async () => {
		const seam = recording({ selector: false });
		await expect(takeSnapshot(1, seam, 1000, { ignoreOcclusion: true })).rejects.toThrow(
			OCCLUSION_UNAVAILABLE,
		);
		expect(seam.calls).toEqual(["off"]);
	});

	test("a shim with no occlusion seam refuses instead of silently ignoring the opt-in", async () => {
		const seam = recording();
		delete seam.occlusion;
		await expect(takeSnapshot(1, seam, 1000, { ignoreOcclusion: true })).rejects.toThrow(
			"occlusion-capable shim",
		);
		expect(seam.calls).toEqual([]);
	});
});
