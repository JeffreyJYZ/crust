/**
 * The panel is one fixed-position element on its own compositor layer. Dragging changes its
 * `transform` and nothing else, so showing or moving it cannot reflow the app's document. Its
 * corner is stored through the app's existing `crust:store` plugin — never a file of its own —
 * and a missing or refusing store degrades to an in-memory corner.
 */

import { createSparkline, type CanvasLike, type Sparkline } from "./sparkline.ts";

export interface ElementLike {
	style: Record<string, string>;
	textContent: string;
	appendChild(child: ElementLike): void;
	addEventListener(type: string, fn: (event: PointerLike) => void): void;
	setPointerCapture?(pointerId: number): void;
	releasePointerCapture?(pointerId: number): void;
	remove(): void;
}

export interface PointerLike {
	clientX: number;
	clientY: number;
	pointerId?: number;
}

export interface DocumentLike {
	createElement(tag: string): ElementLike;
	body: ElementLike;
}

export interface StoreLike {
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<unknown>;
}

export interface PanelOptions {
	doc?: DocumentLike;
	store?: StoreLike;
	title?: string;
	onToggle?: (visible: boolean) => void;
}

const CORNER_KEY = "perf-overlay.corner";

/** A store that goes through the page's own `invoke`, or undefined when there is no bridge. */
export function bridgeStore(crust: unknown): StoreLike | undefined {
	const invoke = (crust as { invoke?: unknown } | undefined)?.invoke;
	if (typeof invoke !== "function") return undefined;
	const call = invoke as (plugin: string, command: string, args?: unknown) => Promise<unknown>;
	return {
		async get(key) {
			try {
				const answer = (await call("store", "get", { key })) as { value?: unknown } | null;
				return answer?.value ?? null;
			} catch {
				return null;
			}
		},
		async set(key, value) {
			try {
				await call("store", "set", { key, value });
			} catch {
				// A refused store never takes the panel down with it.
			}
			return value;
		},
	};
}

function cornerOf(value: unknown): { x: number; y: number } | undefined {
	if (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { x?: unknown }).x === "number" &&
		typeof (value as { y?: unknown }).y === "number"
	) {
		const { x, y } = value as { x: number; y: number };
		return { x, y };
	}
	return undefined;
}

export function createPanel(options: PanelOptions = {}) {
	const doc: DocumentLike = options.doc ?? (globalThis as { document?: DocumentLike }).document!;
	const store = options.store;
	const root = doc.createElement("div");
	Object.assign(root.style, {
		position: "fixed",
		left: "0",
		top: "0",
		transform: "translate3d(0px, 0px, 0)",
		willChange: "transform",
		contain: "layout style paint",
		zIndex: "2147483647",
		display: "none",
		font: "12px/1.45 ui-monospace, SFMono-Regular, monospace",
		color: "#d8d8d8",
		background: "rgba(12,12,14,0.92)",
		border: "1px solid #333",
		borderRadius: "8px",
		padding: "8px 10px",
		width: "280px",
		pointerEvents: "auto",
	});
	const header = doc.createElement("div");
	header.textContent = `crust perf · ${options.title ?? "overlay"} · drag to move`;
	Object.assign(header.style, { cursor: "move", userSelect: "none", color: "#8a8a8a" });
	const text = doc.createElement("pre");
	Object.assign(text.style, { margin: "6px 0", whiteSpace: "pre-wrap", minHeight: "1em" });
	const canvas = doc.createElement("canvas") as ElementLike & CanvasLike;
	canvas.width = 260;
	canvas.height = 48;
	Object.assign(canvas.style, { display: "block", width: "260px", height: "48px" });
	const spark: Sparkline = createSparkline(canvas);
	root.appendChild(header);
	root.appendChild(text);
	root.appendChild(canvas);
	doc.body.appendChild(root);

	let x = 8;
	let y = 8;
	let visible = false;
	let drag: { x: number; y: number; ox: number; oy: number } | undefined;
	const place = (): void => {
		root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
	};
	void store?.get(CORNER_KEY).then((saved) => {
		const corner = cornerOf(saved);
		if (corner) {
			x = corner.x;
			y = corner.y;
			place();
		}
	});

	header.addEventListener("pointerdown", (e) => {
		drag = { x: e.clientX, y: e.clientY, ox: x, oy: y };
		// Capture keeps move/up on the header when the pointer leaves it mid-drag.
		if (e.pointerId !== undefined) header.setPointerCapture?.(e.pointerId);
	});
	header.addEventListener("pointermove", (e) => {
		if (!drag) return;
		x = drag.ox + e.clientX - drag.x;
		y = drag.oy + e.clientY - drag.y;
		place();
	});
	const endDrag = (e: PointerLike, persist: boolean): void => {
		if (!drag) return;
		if (e.pointerId !== undefined) header.releasePointerCapture?.(e.pointerId);
		drag = undefined;
		if (persist) void store?.set(CORNER_KEY, { x, y });
	};
	header.addEventListener("pointerup", (e) => endDrag(e, true));
	header.addEventListener("pointercancel", (e) => endDrag(e, false));

	return {
		element: root,
		show(): void {
			if (visible) return;
			visible = true;
			root.style.display = "block";
			options.onToggle?.(true);
		},
		hide(): void {
			if (!visible) return;
			visible = false;
			root.style.display = "none";
			options.onToggle?.(false);
		},
		get visible(): boolean {
			return visible;
		},
		update(lines: string[], p95: number, now: number): void {
			text.textContent = lines.join("\n");
			spark.push(p95, now);
			spark.draw();
		},
		text: (): string => text.textContent,
		spark,
		moveTo(nx: number, ny: number): void {
			x = nx;
			y = ny;
			place();
		},
		destroy(): void {
			root.remove();
			visible = false;
		},
	};
}

export type Panel = ReturnType<typeof createPanel>;
