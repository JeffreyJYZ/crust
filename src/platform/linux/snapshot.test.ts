import { describe, expect, test } from "bun:test";
import { WindowAdapterError } from "@/plugins/window";
import {
	SNAPSHOT_STATUS,
	linuxSnapshotShim,
	snapshotFrom,
	snapshotStartReason,
	takeLinuxSnapshot,
	type LinuxSnapshotShim,
} from "./snapshot.ts";
import type { LinuxShim } from "./shim-ffi.ts";

/** A valid, non-empty PNG byte stand-in with the numbers a page would size an `<img>` by. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function shim(over: Partial<LinuxSnapshotShim> = {}): LinuxSnapshotShim {
	return {
		ready: () => true,
		take: () => SNAPSHOT_STATUS.started,
		generation: () => 0,
		resultGeneration: () => 0,
		state: () => 1,
		failure: () => "",
		read: () => ({ width: 320, height: 200, scale: 1, png: PNG }),
		...over,
	};
}

const codeOf = (error: unknown): string =>
	error instanceof WindowAdapterError ? error.code : "untyped";

describe("the Linux snapshot promise", () => {
	test("a finished picture becomes the same payload the macOS half answers", async () => {
		const answer = await takeLinuxSnapshot(7n, shim());
		expect(answer).toEqual({
			width: 320,
			height: 200,
			scale: 1,
			png: Buffer.from(PNG).toString("base64"),
		});
	});

	test("the view handle reaches the native take call", async () => {
		let taken = 0n;
		await takeLinuxSnapshot(99n, shim({ take: (view) => ((taken = view), 0) }));
		expect(taken).toBe(99n);
	});

	test("a view that is not realised refuses with a named error, not an empty PNG", async () => {
		const failing = takeLinuxSnapshot(
			1n,
			shim({
				take: () => SNAPSHOT_STATUS.notRealised,
			}),
		);
		await expect(failing).rejects.toThrow("not realised");
		await expect(failing).rejects.toBeInstanceOf(WindowAdapterError);
	});

	test("an API that did not resolve refuses by name", async () => {
		await expect(takeLinuxSnapshot(1n, shim({ ready: () => false }))).rejects.toThrow(
			"unavailable on GTK3",
		);
	});

	test("a refused snapshot reports the reason C gave", async () => {
		await expect(
			takeLinuxSnapshot(
				1n,
				shim({ state: () => 2, failure: () => "WebKit took no snapshot" }),
			),
		).rejects.toThrow("WebKit took no snapshot");
	});

	test("an answer that never lands times out instead of hanging", async () => {
		await expect(takeLinuxSnapshot(1n, shim({ state: () => 0 }), 15)).rejects.toThrow(
			"did not answer within 15 ms",
		);
	});

	test("a second capture while one is pending refuses rather than answering for the first", async () => {
		let answered = false;
		const held = shim({ state: () => (answered ? 1 : 0) });
		const first = takeLinuxSnapshot(1n, held, 1000);
		await Bun.sleep(5);
		const second = takeLinuxSnapshot(2n, shim(), 1000);
		await expect(second).rejects.toThrow("superseded");
		answered = true;
		await first;
	});

	/**
	 * `inFlight` only guards the promise. Once a timeout clears it, a late WebKit callback from the
	 * first capture could publish into the shared result and answer the second with the first view.
	 */
	test("a late result from a timed-out take cannot answer the next capture", async () => {
		let generation = 0;
		let resultGen = -1;
		let published = false;
		const late = shim({
			take: () => {
				generation++;
				resultGen = -1;
				published = false;
				return SNAPSHOT_STATUS.started;
			},
			generation: () => generation,
			resultGeneration: () => resultGen,
			state: () => (published ? 1 : 0),
		});
		const first = takeLinuxSnapshot(1n, late, 5);
		await expect(first).rejects.toThrow("did not answer");

		const second = takeLinuxSnapshot(2n, late, 40);
		await Bun.sleep(5);
		// The first take's WebKit callback finally lands, carrying generation 1.
		resultGen = 1;
		published = true;
		await expect(second).rejects.toThrow("earlier capture");
	});
});

describe("the snapshot payload rule", () => {
	test("an empty PNG is refused", () => {
		expect(() =>
			snapshotFrom({ width: 1, height: 1, scale: 1, png: new Uint8Array() }),
		).toThrow("empty PNG");
	});

	test("numbers that cannot size a picture are refused", () => {
		expect(() => snapshotFrom({ width: 0, height: 1, scale: 1, png: PNG })).toThrow(
			"not a picture",
		);
		expect(() => snapshotFrom({ width: 1, height: 1, scale: 0, png: PNG })).toThrow(
			"not a picture",
		);
	});

	test("every refusal carries the typed handler-error code", () => {
		try {
			snapshotFrom({ width: 1, height: 1, scale: 1, png: new Uint8Array() });
			expect.unreachable();
		} catch (error) {
			expect(codeOf(error)).toBe("handler-error");
		}
	});

	test("unknown start statuses still name where they came from", () => {
		expect(snapshotStartReason(42)).toContain("unknown status 42");
		expect(snapshotStartReason(SNAPSHOT_STATUS.noView)).toContain("null");
	});
});

/** The byte seam over a fake FFI table: length first, then an exact-size copy. */
function native(over: Partial<LinuxShim> = {}): LinuxShim {
	return {
		shim_snapshot_ready: () => 1,
		shim_snapshot_length: () => PNG.length,
		shim_snapshot_read: (dst) => {
			for (let i = 0; i < PNG.length; i++) dst[i] = PNG[i] as number;
			return PNG.length;
		},
		shim_snapshot_width: () => 320,
		shim_snapshot_height: () => 200,
		shim_snapshot_scale: () => 1,
		...over,
	} as LinuxShim;
}

describe("the byte seam", () => {
	test("a finished picture copies every byte and reports the real numbers", () => {
		expect(linuxSnapshotShim(native()).read()).toEqual({
			width: 320,
			height: 200,
			scale: 1,
			png: PNG,
		});
	});

	test("a short copy is a named error, never a partial PNG", () => {
		const short = native({ shim_snapshot_read: () => 2 });
		expect(() => linuxSnapshotShim(short).read()).toThrow("read 2 of 11 PNG bytes");
	});

	test("no bytes at all is a named error", () => {
		const empty = native({ shim_snapshot_length: () => 0 });
		expect(() => linuxSnapshotShim(empty).read()).toThrow("no PNG bytes");
	});
});
