/**
 * Phase 3: the image holds the app, and comes off again.
 *
 * Detach lives in a `finally`, because a failed assertion must not leave a
 * volume on the user's desktop.
 */
import { lstat, readlink, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { runCommand, type Verdict } from "../../e2e-harness.ts";
import { lastLine, skip } from "../../lib/text.ts";
import { BINARY_NAME, REPO_ROOT } from "../fixture.ts";
import { type Attachment, detachImage, parseAttachment, recordAttachment } from "../hdiutil.ts";
import type { Built } from "./build.ts";

export async function mountPhase(
	verdict: Verdict,
	built: Built,
	appName: string,
	printedVolume: string,
): Promise<void> {
	const attach = await runCommand(
		["hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen", built.image],
		REPO_ROOT,
	);
	const attachment: Attachment | undefined =
		attach.code === 0 ? parseAttachment(attach.stdout, built.image) : undefined;
	recordAttachment(attachment);
	verdict.check(
		"attach",
		attachment !== undefined,
		attachment
			? `${attachment.mountPoint} on ${attachment.mountedDevice} (${attachment.devices.length} device lines parsed)`
			: attach.code !== 0
				? `hdiutil attach exited ${attach.code} — ${lastLine(attach.stderr) || lastLine(attach.stdout)}`
				: `hdiutil attach exited 0 but printed no mount point — ${lastLine(attach.stdout)}`,
	);

	let detached = { ok: false, detail: "nothing was attached, so nothing needed detaching" };
	try {
		if (attachment === undefined) {
			skip(
				verdict,
				["image app", "image link", "volume"],
				"not checked — the image never mounted",
			);
		} else {
			const inside = join(attachment.mountPoint, `${appName}.app`);
			const insideStat = await stat(inside).catch(() => undefined);
			const insideBinary = await stat(join(inside, "Contents", "MacOS", BINARY_NAME)).catch(
				() => undefined,
			);
			verdict.check(
				"image app",
				insideStat?.isDirectory() === true && insideBinary?.isFile() === true,
				insideStat?.isDirectory() === true && insideBinary?.isFile() === true
					? `${inside} holds an executable ${BINARY_NAME}`
					: `${inside} ${insideStat?.isDirectory() === true ? "has no executable" : "is missing"}`,
			);

			// The drag-to-Applications convention is the point of the image: without
			// this symlink the mounted folder is a copy of the app and nothing more.
			const link = join(attachment.mountPoint, "Applications");
			const linkStat = await lstat(link).catch(() => undefined);
			const linkTarget = linkStat?.isSymbolicLink() === true ? await readlink(link) : "";
			verdict.check(
				"image link",
				linkTarget === "/Applications",
				linkTarget === "/Applications"
					? "Applications points at /Applications, so one drag installs"
					: `Applications ${linkStat ? `points at ${linkTarget || "?"}` : "is missing"} — the image is a copy of the app, not an installer`,
			);

			const mountedName = basename(attachment.mountPoint);
			verdict.check(
				"volume",
				printedVolume === mountedName,
				printedVolume === mountedName
					? `printed volume "${printedVolume}" is the mounted volume`
					: `printed volume "${printedVolume || "(none)"}" but the image mounted as "${mountedName}"`,
			);
		}
	} finally {
		// Not an assertion's job: a failed check above must not leave the volume on
		// the desktop, so the detach runs whatever happened inside the `try`.
		if (attachment !== undefined) detached = await detachImage(attachment);
	}

	verdict.check("detach", detached.ok, detached.detail);
}
