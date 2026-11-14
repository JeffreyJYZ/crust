/** The two documents the project serves: the driver's page and the spare's. */
import { APP_NAME } from "./config.ts";

export const INDEX_SOURCE = `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>${APP_NAME}</title>
	</head>
	<body>
		<main>
			<h1>${APP_NAME}</h1>
			<p id="status">driving the window plugin…</p>
		</main>
		<script src="/app.js"></script>
	</body>
</html>
`;

/**
 * The spare window's page: served from `/spare/`, alive, and deliberately
 * script-free, so a window created with `url: "/spare/idle.html"` runs nothing
 * and cannot report twice. Its path is what a relative `create` URL is resolved
 * against; see `config.ts`.
 */
export const IDLE_SOURCE = `<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<title>Idle</title>
	</head>
	<body>
		<p>a second window, so a different label is a different NSWindow</p>
	</body>
</html>
`;
