/**
 * The macOS snapshot half, proven without a window. The C unit is compiled and its global
 * completion block built — the half that would otherwise only show as a handler that never fires —
 * and a null webview is refused instead of sending into nil. Every promise path then runs on a fake
 * `SnapshotShim`, so the base64, the measured size and each refusal are proved byte for byte
 * without WebKit. The real picture needs a live window: `scripts/e2e-capture.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	SNAPSHOT_STATUS,
	SNAPSHOT_TIMEOUT_MS,
	type SnapshotBytes,
	type SnapshotShim,
	snapshotFrom,
	snapshotStartReason,
	snapshotUnit,
	snapshotUnitStatus,
	takeSnapshot,
} from "@/platform/darwin/snapshot.ts";

const notDarwin = process.platform !== "darwin";

/** A PNG signature, so a base64 answer is provably a PNG file rather than a string. */
const PNG_BYTES = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const PICTURE: SnapshotBytes = {
	width: 2200,
	height: 1520,
	scale: 2,
	flat: false,
	png: PNG_BYTES,
};

/**
 * A byte seam that answers as told. `answer` decides what the completion handler reports, and
 * `when: "during"` fires it inside `take`, which is the ordering a cached page produces and the one
 * the pending slot exists to survive.
 */
function shim(
	options: {
		answer?: boolean;
		bytes?: SnapshotBytes;
		status?: number;
		when?: "after" | "during" | "never";
	} = {},
): SnapshotShim & { listened: number } {
	const answer = options.answer ?? true;
	const bytes = options.bytes ?? PICTURE;
	const status = options.status ?? SNAPSHOT_STATUS.started;
	const when = options.when ?? "after";
	const seam = {
		listened: 0,
		available: () => true,
		take(view: number, id: number) {
			void view;
			if (when === "during") seam.channel?.(id, answer);
			if (when === "after") queueMicrotask(() => seam.channel?.(id, answer));
			return status;
		},
		read: () => bytes,
		setChannel(onAnswer: (id: number, ok: boolean) => void) {
			seam.listened++;
			seam.channel = onAnswer;
		},
		channel: undefined as ((id: number, ok: boolean) => void) | undefined,
	};
	return seam;
}

describe("snapshot unit", () => {
	test.skipIf(notDarwin)("compiles and builds its global completion block", () => {
		expect(snapshotUnitStatus()).toEqual({ available: true, reason: "compiled" });
		expect(Number(snapshotUnit().symbols.crust_shot_block_ready() ?? 0)).toBe(1);
	});

	test.skipIf(notDarwin)("a null webview is refused instead of sending into nil", () => {
		const { symbols } = snapshotUnit();
		expect(Number(symbols.crust_shot_available(0) ?? -1)).toBe(0);
		expect(Number(symbols.crust_shot_take(0, 1) ?? -1)).toBe(SNAPSHOT_STATUS.unavailable);
		// Nothing was taken, so the reads say so rather than answering stale bytes.
		expect(Number(symbols.crust_shot_length() ?? 0)).toBe(-1);
		expect(Number(symbols.crust_shot_read(0, 0) ?? 0)).toBe(-1);
	});
});

describe("the capture promise", () => {
	test("answers the measured size and the PNG as base64", async () => {
		const seam = shim();
		const answer = await takeSnapshot(7, seam);

		expect(answer.width).toBe(2200);
		expect(answer.height).toBe(1520);
		expect(answer.scale).toBe(2);
		expect(Buffer.from(answer.png, "base64")).toEqual(Buffer.from(PNG_BYTES));
		expect(answer.png).not.toContain("data:");
		expect(seam.listened).toBe(1);
	});

	test("a handler that fires during the send is still answered, not lost", async () => {
		const answer = await takeSnapshot(1, shim({ when: "during" }));
		expect(answer.scale).toBe(2);
	});

	test("a refused render rejects by name instead of answering a blank picture", async () => {
		const failing = takeSnapshot(1, shim({ answer: false }));
		await expect(failing).rejects.toThrow(snapshotStartReason(SNAPSHOT_STATUS.noPicture));
	});

	/**
	 * The state measured on macOS 27: `takeSnapshot` starts, the page keeps running, and WebKit
	 * never calls the completion handler — a window that has never been composited at -4000,-4000
	 * does exactly this. A stall at the seam reproduces the state without depending on which app
	 * owns the fullscreen Space, and must answer a named failure rather than a blank png.
	 */
	test("a completion that never fires is named, never an empty picture", async () => {
		const failing = takeSnapshot(1, shim({ when: "never" }), 40);
		await expect(failing).rejects.toThrow(snapshotStartReason(SNAPSHOT_STATUS.noCompletion));
		await expect(failing).rejects.not.toThrow("empty PNG");
	});

	test("every failure status names its reason", () => {
		for (const status of Object.values(SNAPSHOT_STATUS)) {
			if (status === SNAPSHOT_STATUS.started) continue;
			expect(snapshotStartReason(status)).not.toMatch(/^unknown status/);
		}
	});

	test("a capture that never starts rejects with the reason C gave", async () => {
		await expect(
			takeSnapshot(1, shim({ status: SNAPSHOT_STATUS.unavailable })),
		).rejects.toThrow(snapshotStartReason(SNAPSHOT_STATUS.unavailable));
	});

	test("a picture with no bytes or no size is refused, never base64 of nothing", () => {
		expect(() => snapshotFrom({ ...PICTURE, png: new Uint8Array() })).toThrow("empty PNG");
		expect(() => snapshotFrom({ ...PICTURE, width: 0 })).toThrow("not a picture");
		expect(() => snapshotFrom({ ...PICTURE, scale: 0 })).toThrow("not a picture");
	});

	test("a handler that never answers is reported after the timeout", async () => {
		const started = Date.now();
		await expect(takeSnapshot(1, shim({ when: "never" }), 60)).rejects.toThrow(
			snapshotStartReason(SNAPSHOT_STATUS.noCompletion),
		);
		expect(Date.now() - started).toBeGreaterThanOrEqual(40);
		// The default a page gets is the real one, so the short one above is only this suite's.
		expect(SNAPSHOT_TIMEOUT_MS).toBe(5000);
	});

	test("a second capture supersedes the first instead of leaving it hanging", async () => {
		const first = takeSnapshot(1, shim({ when: "never" }));
		const second = takeSnapshot(2, shim());
		await expect(first).rejects.toThrow("superseded this one");
		expect((await second).width).toBe(2200);
	});

	test("a late completion from the older render cannot answer the newer capture", async () => {
		let channel: ((id: number, ok: boolean) => void) | undefined;
		let picture = PICTURE;
		const ids: number[] = [];
		const seam: SnapshotShim = {
			available: () => true,
			take(_view, id) {
				ids.push(id);
				// The first WebKit render is already in flight when the second capture starts; its
				// completion lands through the sink the second capture installed.
				if (ids.length === 1) queueMicrotask(() => channel?.(id, true));
				return SNAPSHOT_STATUS.started;
			},
			read: () => picture,
			setChannel: (onAnswer) => {
				channel = onAnswer;
			},
		};
		const first = takeSnapshot(1, seam);
		const second = takeSnapshot(2, seam);
		await expect(first).rejects.toThrow("superseded this one");

		// The stale completion now lands. If it settled `second`, this picture would be returned.
		picture = { ...PICTURE, width: 111 };
		await Promise.resolve();
		await Promise.resolve();
		let settled = false;
		void second.then(
			() => (settled = true),
			() => (settled = true),
		);
		await Promise.resolve();
		expect(settled).toBe(false);

		picture = { ...PICTURE, width: 222 };
		channel?.(ids[1] as number, true);
		expect((await second).width).toBe(222);
	});
});
