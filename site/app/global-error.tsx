"use client";

/**
 * Root-layout failures land here. Next renders this instead of `layout.tsx`, so
 * it carries its own `<html>`/`<body>`, gets no global stylesheet (hence the
 * inline rules below, reading the same token names), and cannot export
 * `metadata` — the title is a `<title>` element for that reason.
 */
export default function GlobalError({
	error,
	retry,
}: {
	error: unknown;
	retry: () => void;
}) {
	const message = error instanceof Error ? error.message : undefined;
	const digest =
		typeof error === "object" && error !== null && "digest" in error
			? String((error as { digest?: unknown }).digest ?? "")
			: "";

	return (
		<html lang="en">
			<body>
				<title>Something broke · crust</title>
				<style>{`
					body { margin: 0; background: var(--bg, #0b0b0c); color: var(--fg, #e7e7e6); }
					main.fallback { max-width: 34rem; margin: 0 auto; padding: 96px 24px 32px; }
					main.fallback h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
					main.fallback p { color: var(--muted, #93938f); margin: 0 0 10px; }
					main.fallback button { margin-top: 8px; padding: 8px 14px; font: inherit;
						color: var(--fg, #e7e7e6); background: transparent; cursor: pointer;
						border: 0.5px solid var(--line, #2a2a2d); }
					main.fallback button:hover { border-color: var(--muted, #93938f); }
					footer.site { padding: 24px; text-align: center; font-size: 11px; }
					footer.site a { color: var(--muted, #93938f); text-decoration: none; }
				`}</style>
				<main className="fallback">
					<h1>Something broke</h1>
					<p>
						This page failed to render. Retrying usually clears it.
						{digest ? ` Reference: ${digest}` : ""}
					</p>
					{message ? <p>{message}</p> : null}
					<button type="button" onClick={() => retry()}>
						Try again
					</button>
				</main>
				<footer className="site">
					<a href="https://jyz.land">jyz.land</a>
				</footer>
			</body>
		</html>
	);
}
