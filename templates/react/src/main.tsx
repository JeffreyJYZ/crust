import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * Dark by default, readable on light: everything below is one inline palette,
 * chosen from prefers-color-scheme, so the template ships no stylesheet.
 */
const light = window.matchMedia("(prefers-color-scheme: light)").matches;
const colors = light
	? { bg: "#fafafa", panel: "#ffffff", line: "#e2e4e8", text: "#1b1d21", muted: "#5f646c", ok: "#3f7a1f", bad: "#b4232f" }
	: { bg: "#0e0f11", panel: "#17191c", line: "#25292e", text: "#e8eaed", muted: "#9aa0a6", ok: "#9ece6a", bad: "#f7768e" };

const mono = "ui-monospace, 'SF Mono', SFMono-Regular, monospace";
const sans = "system-ui, -apple-system, 'SF Pro Text', sans-serif";

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
		fontSize: 15,
		lineHeight: 1.55,
	},
	card: {
		width: "min(560px, 100%)",
		padding: 32,
		border: `1px solid ${colors.line}`,
		borderRadius: 14,
		background: colors.panel,
	},
	eyebrow: {
		margin: "0 0 10px",
		color: colors.muted,
		fontSize: 11,
		fontWeight: 600,
		letterSpacing: "0.14em",
		textTransform: "uppercase",
	},
	heading: { margin: "0 0 12px", fontSize: 26, letterSpacing: "-0.02em" },
	lede: { margin: "0 0 22px", color: colors.muted },
	answer: {
		margin: 0,
		padding: "14px 16px",
		border: `1px solid ${colors.line}`,
		borderRadius: 9,
		background: colors.bg,
		fontFamily: mono,
		fontSize: 13,
	},
} as const;

type Answer = { text: string; ok: boolean } | null;

/** The page half: one call to the backend's `greet` command, on mount. */
function App() {
	const [answer, setAnswer] = useState<Answer>(null);

	useEffect(() => {
		let alive = true;
		window.crust
			.invoke("greet", { name: "react" })
			.then((value) => {
				if (alive) setAnswer({ text: String(value), ok: true });
			})
			.catch((error: unknown) => {
				if (alive) setAnswer({ text: error instanceof Error ? error.message : String(error), ok: false });
			});
		return () => {
			alive = false;
		};
	}, []);

	return (
		<main style={styles.main}>
			<section style={styles.card}>
				<p style={styles.eyebrow}>crust + react</p>
				<h1 style={styles.heading}>Window, bridge, handler.</h1>
				<p style={styles.lede}>
					This page was built by Vite, embedded in the app bundle, and served by the
					bridge. The line below is the backend's answer.
				</p>
				<p
					style={{
						...styles.answer,
						color: answer === null ? colors.muted : answer.ok ? colors.ok : colors.bad,
					}}
					aria-live="polite"
				>
					{answer === null ? "asking the backend…" : answer.text}
				</p>
			</section>
		</main>
	);
}

document.body.style.margin = "0";
document.body.style.background = colors.bg;

const container = document.getElementById("root");
if (!container) throw new Error("react: index.html has no #root element");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
