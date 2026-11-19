import type { Validator } from "./validator.ts";

export const DEV_KEYS = ["url", "beforeDevCommand"] as const;

/**
 * `dev.url` loads the page in `crust dev` once, with no retry. A string like `localhost:5173`
 * parses as a scheme with an empty host, so the runtime waits 30 s on a page nothing serves; a
 * string like `not a url` throws only when the page URL is built. Both belong at config time.
 */
const DEV_URL =
	"an absolute http(s) URL with a host (crust dev loads this page; a hostless or unparseable " +
	"string waits 30 s and then fails to render)";

export function validateDev(v: Validator, value: unknown): void {
	if (value === undefined) return;
	const dev = v.object("dev", value);
	if (!dev) return;
	v.only(dev, "dev", DEV_KEYS);

	const url = v.string(dev, "url", "dev", false);
	if (url !== undefined && !isDevUrl(url)) v.fail("dev.url", DEV_URL, url);
	v.string(dev, "beforeDevCommand", "dev", false);
}

function isDevUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
	} catch {
		return false;
	}
}
