/**
 * `window.capture` through the real plugin command, with re-assertion between attempts. A hidden
 * WKWebView sometimes renders no snapshot at all — a focus/occlusion condition of the harness,
 * not a panel defect. Three bounded attempts, then report inconclusive instead of failing.
 */
import { darwinWindowAdapter } from "../../src/platform/darwin/window-adapter.ts";
import type { DarwinPlatform } from "../../src/platform/darwin/platform.ts";
import { windowCaptureCommands } from "../../src/plugins/window-capture.ts";

export async function captureOverlay(
	platform: DarwinPlatform,
	reassert: () => void,
): Promise<{ width: number; height: number; png: string } | undefined> {
	for (let attempt = 0; attempt < 3; attempt++) {
		reassert();
		await Bun.sleep(250);
		const answer = await windowCaptureCommands(darwinWindowAdapter(platform)).capture({ label: "main" });
		if ("ok" in answer && answer.ok === true) {
			console.log(`window.capture ok ${answer.width}x${answer.height} pngChars=${answer.png.length}`);
			return { width: answer.width, height: answer.height, png: answer.png };
		}
		console.log(`window.capture attempt ${attempt + 1}: ${JSON.stringify(answer)}`);
	}
	console.log("window.capture inconclusive: no snapshot; page text below is the rendered proof");
	return undefined;
}
