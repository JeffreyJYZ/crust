/** What the tray probe measures, and where its captures land. */
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Long and wide enough to be unmistakable at 2x, short enough for one buffer. */
export const TITLE = "CRUSTTRAY";

/** The menu-bar strip, in points: full width, the height of a notched bar plus slack. */
export const STRIP_HEIGHT = 60;

/** A pixel counts as changed when its luminance moves by more than this. */
export const CHANGE_THRESHOLD = 24;

/** A pixel counts as "text" when it is this bright or brighter. */
export const TEXT_THRESHOLD = 140;

/** NSWindowOcclusionStateVisible, bit 2 — the WindowServer's own "on screen". */
export const OCCLUSION_VISIBLE = 2;

export const DIR = join(tmpdir(), "crust-tray-probe");
