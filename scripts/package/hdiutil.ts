/**
 * Attaching and ejecting the built image.
 *
 * The device to detach is parsed from `hdiutil attach`'s own table, never guessed
 * from `/Volumes/<name>`: `diskutil image create from` writes an APFS container,
 * so the command prints several `/dev/disk*` lines and only one carries the mount
 * point.
 */
import { runCommand } from "../e2e-harness.ts";
import { REPO_ROOT } from "./fixture.ts";

export interface Attachment {
	/** Every device line `hdiutil attach` printed, in order. */
	devices: string[];
	/** The device whose line carried the mount point. */
	mountedDevice: string;
	mountPoint: string;
	dmgPath: string;
}

/** The volume currently attached, so a throw can still detach it. */
let attachment: Attachment | undefined;
/** Where it was mounted, kept after detach so the run can assert it is gone. */
let mountedAt: string | null = null;

/** Record what this run attached, so `main`'s finally can eject it. */
export function recordAttachment(target: Attachment | undefined): void {
	attachment = target;
	mountedAt = target?.mountPoint ?? null;
}

/** Where the image was mounted, for the closing "mount clear" assertion. */
export function mountPointSeen(): string | null {
	return mountedAt;
}

/**
 * Parse `hdiutil attach`'s table into the device to detach.
 *
 * The table is tab-separated, `/dev/disk*` first and the mount point last, and an
 * image made by `diskutil image create from` prints four lines for one mount
 * (partition scheme, APFS container, its slice). Only one line names a mount
 * point, so that line — never a guess at `/Volumes/<name>` — is what is detached.
 */
export function parseAttachment(stdout: string, dmgPath: string): Attachment | undefined {
	const devices: string[] = [];
	let mountedDevice = "";
	let mountPoint = "";
	for (const raw of stdout.split("\n")) {
		const cells = raw
			.split(/\t+|\s{2,}/)
			.map((cell) => cell.trim())
			.filter((cell) => cell.length > 0);
		const device = cells[0];
		if (device === undefined || !device.startsWith("/dev/disk")) continue;
		devices.push(device);
		const mounted = cells.find((cell) => cell.startsWith("/") && !cell.startsWith("/dev/"));
		if (mounted !== undefined && mountPoint.length === 0) {
			mountPoint = mounted;
			mountedDevice = device;
		}
	}
	if (mountPoint.length === 0 || mountedDevice.length === 0) return undefined;
	return { devices, mountedDevice, mountPoint, dmgPath };
}

/** Whether `mountPoint` is still in the mount table, matched as a whole field. */
export async function isMounted(mountPoint: string): Promise<boolean> {
	const { stdout } = await runCommand(["mount"], REPO_ROOT);
	return stdout.split("\n").some((line) => line.includes(` on ${mountPoint} (`));
}

/** Whether `hdiutil` still holds `dmgPath`; the image path is unique per run. */
async function imageAttached(dmgPath: string): Promise<boolean> {
	const { stdout } = await runCommand(["hdiutil", "info"], REPO_ROOT);
	return stdout.includes(dmgPath);
}

/**
 * Eject the image, escalating from the container device to `-force`.
 *
 * Detaching the whole disk (`/dev/disk15` for `/dev/disk15s1`) is what releases an
 * APFS container; detaching the slice alone can leave the container behind. The
 * result is verified against the mount table and `hdiutil info`, because an exit 0
 * from a deprecated command is not the same fact as an unmounted volume.
 */
export async function detachImage(target: Attachment): Promise<{ ok: boolean; detail: string }> {
	const candidates = [
		target.mountedDevice.replace(/s\d+$/, ""),
		target.mountedDevice,
		...[...target.devices].reverse(),
	];
	const tried = new Set<string>();
	let last = "no device line to detach";
	for (const device of candidates) {
		if (device.length === 0 || tried.has(device)) continue;
		tried.add(device);
		for (const force of [false, true]) {
			const args = ["hdiutil", "detach", ...(force ? ["-force"] : []), device];
			const result = await runCommand(args, REPO_ROOT);
			last = `${args.join(" ")} exited ${result.code}`;
			if (result.code !== 0) continue;
			const stillMounted = await isMounted(target.mountPoint);
			const stillAttached = await imageAttached(target.dmgPath);
			if (!stillMounted && !stillAttached) {
				return { ok: true, detail: `${device} ejected ${target.mountPoint}` };
			}
			last += stillMounted
				? ` but ${target.mountPoint} is still mounted`
				: " but the image is still attached";
		}
	}
	return { ok: false, detail: `${last} — ${target.mountPoint} may still be on the desktop` };
}

/** Detach whatever this run left behind. Idempotent, never throws. */
export async function detachLeftover(): Promise<void> {
	if (attachment === undefined) return;
	const mounted = await isMounted(attachment.mountPoint);
	const attached = await imageAttached(attachment.dmgPath);
	if (!mounted && !attached) return;
	await detachImage(attachment).catch(() => undefined);
}
