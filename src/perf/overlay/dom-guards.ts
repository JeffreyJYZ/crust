/** Honest narrowing at the DOM seam: a refusal names the missing capability, no `!` or canvas cast. */
import type { DocumentLike, ElementLike } from "./panel.ts";
import type { CanvasLike } from "./sparkline.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** `undefined` means the caller has no DOM; the panel turns that into a named error. */
export function documentOf(value: unknown): DocumentLike | undefined {
	if (!isRecord(value) || typeof value.createElement !== "function" || !isRecord(value.body))
		return undefined;
	return value as unknown as DocumentLike;
}

/** A node that cannot draw is passed as `null`; `createSparkline` already degrades for that. */
export function canvasOf(node: ElementLike): CanvasLike | null {
	if (
		!isRecord(node) ||
		typeof node.getContext !== "function" ||
		typeof node.width !== "number" ||
		typeof node.height !== "number"
	)
		return null;
	return node as unknown as CanvasLike;
}
