/**
 * The status bar: one line per call, plus what the bridge is serving and how
 * many notes the folder holds. It is a live region, so a screen reader hears
 * every answer without the person moving focus.
 */
import type { Status } from "../store";

interface StatusBarProps {
	status: Status;
	info: { url: string; connected: boolean };
	count: number;
}

export function StatusBar({ status, info, count }: StatusBarProps) {
	return (
		<footer className="status" role="status" aria-live="polite">
			<span className={`badge ${status.kind}`} aria-hidden="true" />
			<span className="status-text">{status.text}</span>
			<span className="bridge" title={info.url || "the bridge serves this document"}>
				bridge {info.url || (info.connected ? "embedded" : "missing")} · {count} notes
			</span>
		</footer>
	);
}
