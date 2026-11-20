import { createSignal, onSettled } from "solid-js";

/**
 * Dark by default, readable on light: everything below is one inline palette,
 * chosen from prefers-color-scheme, so the template ships no stylesheet.
 */
const light = window.matchMedia("(prefers-color-scheme: light)").matches;
const colors = light
	? {
			bg: "#fafafa",
			panel: "#ffffff",
			line: "#e2e4e8",
			text: "#1b1d21",
			muted: "#5f646c",
			ok: "#3f7a1f",
			bad: "#b4232f",
		}
	: {
			bg: "#0e0f11",
			panel: "#17191c",
			line: "#25292e",
			text: "#e8eaed",
			muted: "#9aa0a6",
			ok: "#9ece6a",
			bad: "#f7768e",
		};

const mono = "ui-monospace, 'SF Mono', SFMono-Regular, monospace";
const sans = "system-ui, -apple-system, 'SF Pro Text', sans-serif";

// Solid 2's CSS types take a length as `0` or a unit-carrying string, so every
// value below is unitful (`"15px"`, never `15`) — a bare number is a type error.
const styles = {
	main: {
		display: "grid",
		placeItems: "center",
		minHeight: "100vh",
		padding: "32px 24px",
		boxSizing: "border-box",
		background: colors.bg,
		color: colors.text,
		fontFamily: sans,
		fontSize: "15px",
		lineHeight: "1.55",
	},
	card: {
		width: "min(560px, 100%)",
		padding: "32px",
		border: `1px solid ${colors.line}`,
		borderRadius: "14px",
		background: colors.panel,
	},
	eyebrow: {
		margin: "0 0 10px",
		color: colors.muted,
		fontSize: "11px",
		fontWeight: 600,
		letterSpacing: "0.14em",
		textTransform: "uppercase",
	},
	heading: { margin: "0 0 12px", fontSize: "26px", letterSpacing: "-0.02em" },
	lede: { margin: "0 0 22px", color: colors.muted },
	answer: {
		margin: 0,
		padding: "14px 16px",
		border: `1px solid ${colors.line}`,
		borderRadius: "9px",
		background: colors.bg,
		fontFamily: mono,
		fontSize: "13px",
	},
} as const;

type Answer = { text: string; ok: boolean } | null;

/** The page half: one call to the backend's `greet` command, after first render. */
export function App() {
	const [answer, setAnswer] = createSignal<Answer>(null);

	// Solid 2 replaced `onMount` with `onSettled`, and a component body may not
	// write a signal — this callback runs after the first reactive settle.
	// `ready` resolves on the first handshake, so the invoke never races the bridge;
	// the returned function is the teardown, run when the component disposes.
	onSettled(() => {
		let alive = true;
		window.crust.ready
			.then(() => window.crust.invoke<string>("greet", { name: "solid" }))
			.then((value) => {
				if (alive) setAnswer({ text: String(value), ok: true });
			})
			.catch((error: unknown) => {
				if (alive) {
					setAnswer({
						text: error instanceof Error ? error.message : String(error),
						ok: false,
					});
				}
			});
		return () => {
			alive = false;
		};
	});

	const shown = () => answer();

	return (
		<main style={styles.main}>
			<section style={styles.card}>
				<p style={styles.eyebrow}>crust + solid</p>
				<h1 style={styles.heading}>Window, bridge, handler.</h1>
				<p style={styles.lede}>
					This page was built by Vite, embedded in the app bundle, and served by the
					bridge. The line below is the backend's answer.
				</p>
				<p
					style={{
						...styles.answer,
						color:
							shown() === null ? colors.muted : shown()?.ok ? colors.ok : colors.bad,
					}}
					aria-live="polite"
				>
					{shown() === null ? "asking the backend…" : shown()?.text}
				</p>
			</section>
		</main>
	);
}
