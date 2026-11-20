/**
 * `moveToActiveSpace | fullScreenPrimary` = 130: primary makes the green button the fullscreen
 * arrows, where `fullScreenAuxiliary` (256) marks another app's helper and forces the zoom `+`;
 * `canJoinAllSpaces` is out (a window on every Space has none to transition into) and
 * `moveToActiveSpace` keeps the launch behaviour of following the Space being looked at.
 * Split out of `window-create.ts` when that file reached the 200-line cap; the value is read by
 * the fullscreen suite, not by the constructor, which is why it was the one piece that could leave.
 */
export function collectionBehavior(): number {
	return 2 | 128;
}
