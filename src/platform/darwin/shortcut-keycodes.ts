/**
 * The two tables the macOS shortcut adapter maps through: virtual keycodes and Carbon's modifier mask. Data only, split out of `shortcuts.ts` so the dispatch seam fits the 200-line cap.
 */

import type { ShortcutModifier } from "@/plugins/shortcuts";

// Virtual keycodes, `kVK_*` from HIToolbox Events.h, as `<name>:<hex>` pairs. One
// encoded table rather than ninety object rows, because the table is data.
const KEYCODE_TABLE =
	"a:00 s:01 d:02 f:03 h:04 g:05 z:06 x:07 c:08 v:09 b:0b q:0c w:0d e:0e r:0f " +
	"y:10 t:11 1:12 2:13 3:14 4:15 6:16 5:17 =:18 9:19 7:1a -:1b 8:1c 0:1d ]:1e " +
	"[:21 ':27 ;:29 \\:2a ,:2b /:2c .:2f `:32 o:1f u:20 i:22 p:23 l:25 j:26 k:28 " +
	"n:2d m:2e enter:24 tab:30 space:31 backspace:33 escape:35 forwarddelete:75 " +
	"insert:72 home:73 end:77 pageup:74 pagedown:79 up:7e down:7d left:7b right:7c " +
	"f1:7a f2:78 f3:63 f4:76 f5:60 f6:61 f7:62 f8:64 f9:65 f10:6d f11:67 f12:6f " +
	"f13:69 f14:6b f15:71 f16:6a f17:40 f18:4f f19:50";

/** Canonical key name → `kVK_*`. */
export const KEYCODES: ReadonlyMap<string, number> = new Map(
	KEYCODE_TABLE.split(" ").map((pair) => {
		const at = pair.indexOf(":");
		return [pair.slice(0, at), Number.parseInt(pair.slice(at + 1), 16)] as const;
	}),
);

/** Carbon's modifier mask — `cmdKey` 1<<8 and friends, not NSEvent's flags. */
export const MODIFIER_BITS: Record<ShortcutModifier, number> = {
	command: 1 << 8,
	shift: 1 << 9,
	option: 1 << 11,
	control: 1 << 12,
};
