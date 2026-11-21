/**
 * The popup policy: `target=_blank` never becomes a second webview. The platform refuses the new
 * window and hands the URL to the plugin, which re-checks the allow list and only then reaches the
 * system opener. Each case asserts both halves — what the opener received and what the page was told.
 */
import { describe, expect, test } from "bun:test";
import { createBrowserPlugin } from "@/plugins/browser";
import { ALLOWED, BOUNDS, collector, FakeBrowser } from "@/plugins/browser-fake";

function opened(fake: FakeBrowser, events: ReturnType<typeof collector>) {
	const plugin = createBrowserPlugin({ origins: [ALLOWED] }, fake);
	const { ctx } = events;
	plugin.commands.open({ label: "docs", url: `${ALLOWED}/`, bounds: BOUNDS }, ctx);
	const surface = fake.opened[0];
	if (surface === undefined) throw new Error("the fake adapter never received open");
	return surface;
}

describe("browser popups", () => {
	test("an allowed target=_blank reaches the opener and is reported as handed over", () => {
		const fake = new FakeBrowser();
		const events = collector();
		opened(fake, events).onPopup?.(`${ALLOWED}/popup`);
		expect(fake.extended).toEqual([`${ALLOWED}/popup`]);
		expect(events.events).toEqual([
			{
				event: "browser:popup",
				data: { label: "docs", url: `${ALLOWED}/popup`, handedToOpener: true },
			},
		]);
	});

	test("a popup outside the allow list is refused and never reaches the opener", () => {
		const fake = new FakeBrowser();
		const events = collector();
		opened(fake, events).onPopup?.("https://evil.test/");
		expect(fake.extended).toEqual([]);
		expect(events.events[0]).toMatchObject({
			event: "browser:popup",
			data: { label: "docs", url: "https://evil.test/", handedToOpener: false },
		});
		expect((events.events[0]?.data as { reason: string }).reason).toContain(
			"origin https://evil.test",
		);
	});

	test("an opener that refuses is reported, not thrown", () => {
		const fake = new FakeBrowser();
		fake.externalAnswer = { opened: false, reason: "NSWorkspace refused the URL" };
		const events = collector();
		opened(fake, events).onPopup?.(`${ALLOWED}/popup`);
		expect(events.events[0]?.data).toMatchObject({
			handedToOpener: false,
			reason: "NSWorkspace refused the URL",
		});
	});
});
