import { describe, expect, test } from "bun:test";
import { pumpText } from "./command.ts";

function chunks(values: number[][]): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const value of values) controller.enqueue(new Uint8Array(value));
			controller.close();
		},
	});
}

describe("stream text decoding", () => {
	test("stdout and stderr hold independent streaming decoder state", async () => {
		let out = "";
		let err = "";
		await Promise.all([
			pumpText(chunks([[0xc3], [0xa9]]), (text) => {
				out += text;
			}),
			pumpText(chunks([[0x58]]), (text) => {
				err += text;
			}),
		]);
		expect(out).toBe("é");
		expect(err).toBe("X");
	});
});
