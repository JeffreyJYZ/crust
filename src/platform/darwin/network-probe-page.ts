/**
 * The fixtures and the page `network-probe.ts` serves: the bodies two `allow` rules carry and the
 * document that pulls them through the scheme and reports what it read in its own title. Split out
 * so the probe file stays about driving WebKit.
 */

import { NETWORK_SCHEME } from "@/plugins/network";

export const PREFIX = `${NETWORK_SCHEME}://probe`;

/** The text the page must read back, and the width of the SVG it must decode. */
export const BODY = "served-bytes-42";
export const WIDTH = 7;

/** Served as JavaScript: a `<script src>` needs no CORS, so this isolates the scheme from fetch. */
export const DATA = `window.crustBody=${JSON.stringify(BODY)};`;

/** An SVG so a decoded image is provable by its natural width, and it is text, so UTF-8 is safe. */
export const PIXEL = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="5"></svg>`;

/**
 * The page, served over `http://127.0.0.1:<port>` on purpose: that is the origin a crust app's page
 * really has, so its `crust-net:` fetch is genuinely cross-origin. `inline` is the control — the
 * same SVG from a `data:` URL — because an image that fails to decode has two very different causes.
 */
export const PAGE = `<!doctype html><meta charset="utf-8"><title>pending</title>
<script src="${PREFIX}/data"></script>
<img id="pixel" src="${PREFIX}/pixel" onload="window.crustImg='load'" onerror="window.crustImg='error'">
<img id="inline" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='5'/%3E">
<script>
const state = { status: 0, type: "", fetched: "" };
fetch("${PREFIX}/text")
	.then((response) => {
		state.status = response.status;
		state.type = response.headers.get("content-type") || "";
		return response.text();
	})
	.then((body) => { state.fetched = body; })
	.catch((error) => { state.fetched = "ERR " + error; });
const report = () => {
	document.title = "ok script=" + window.crustBody + " status=" + state.status + " type=" + state.type +
		" fetch=" + state.fetched + " img=" + window.crustImg +
		" width=" + document.getElementById("pixel").naturalWidth +
		" inline=" + document.getElementById("inline").naturalWidth;
};
window.addEventListener("load", report);
setInterval(report, 100);
</script>`;
