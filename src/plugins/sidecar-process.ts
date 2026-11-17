/**
 * Process-level helpers for `crust:sidecar`: how a child is spawned, how its output streams are
 * decoded, and the bounded grace before a stubborn child is killed. Kept apart from the command
 * registry so neither file passes the 200-line cap.
 */

/** SIGTERM first; a child that ignores it gets SIGKILL after this long. Injectable in tests. */
export const KILL_GRACE_MS = 2000;

export const encoder = new TextEncoder();

/** `Bun.spawn` opens all three pipes; stdin must be a pipe for `sidecar.write` to drive a daemon. */
export const bunSpawn: import("./sidecar-types").SidecarSpawner = (cmd, options) =>
	Bun.spawn([...cmd], {
		cwd: options.cwd,
		env: options.env,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	}) as unknown as import("./sidecar-types").SidecarChild;

/** Decode a stream to text chunks; an exit does not cancel a reader that is still draining. */
export async function streamText(
	stream: ReadableStream<Uint8Array> | null,
	onText: (text: string) => void,
): Promise<void> {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value && value.byteLength > 0) onText(decoder.decode(value, { stream: true }));
	}
	const tail = decoder.decode();
	if (tail.length > 0) onText(tail);
}
