/**
 * The fake page's document: the root a script queries and the element a point hits. Split from
 * `testing-fake-dom.ts` so each file stays inside the line cap without dropping a rule.
 */

import { FakeElement } from "./testing-fake-dom.ts";

export class FakeDocument {
	readonly body = new FakeElement("body");
	activeElement: FakeElement | null = null;
	readonly roots: FakeElement[] = [this.body];

	constructor() {
		// Appended children find their document through the body, so `focus()` can set activeElement.
		this.body.attach(this);
	}

	querySelector(selector: string): FakeElement | null {
		const walk = (node: FakeElement): FakeElement | null => {
			if (node.matches(selector)) return node;
			for (const child of node.children) {
				const found = walk(child);
				if (found) return found;
			}
			return null;
		};
		for (const root of this.roots) {
			const found = walk(root);
			if (found) return found;
		}
		return null;
	}

	elementFromPoint(x: number, y: number): FakeElement | null {
		const hit = (node: FakeElement): FakeElement | null => {
			const rect = node.getBoundingClientRect();
			const inside =
				x >= rect.left &&
				x <= rect.left + rect.width &&
				y >= rect.top &&
				y <= rect.top + rect.height;
			if (inside && node.tagName !== "BODY") return node;
			for (const child of node.children) {
				const found = hit(child);
				if (found) return found;
			}
			return null;
		};
		return hit(this.body);
	}

	dispatchEvent(): boolean {
		return true;
	}
}
