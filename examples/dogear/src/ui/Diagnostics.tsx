/**
 * The run log under the status bar, and the button that starts the self-check.
 *
 * The same lines the `log` command puts on the terminal land here, so a person
 * can see a check's answers without leaving the window; the panel opens itself
 * once there is a line to read.
 */
interface DiagnosticsProps {
	log: string[];
	onRun: () => void;
}

export function Diagnostics({ log, onRun }: DiagnosticsProps) {
	return (
		<details className="diagnostics" open={log.length > 0}>
			<summary>
				Diagnostics
				<button
					type="button"
					className="small"
					onClick={(event) => {
						event.preventDefault();
						onRun();
					}}
				>
					Run self-check
				</button>
			</summary>
			<pre>{log.length === 0 ? "no checks run yet" : log.join("\n")}</pre>
		</details>
	);
}
