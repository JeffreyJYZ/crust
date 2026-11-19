/** The document the project serves: the driver's own page, with no chrome of its own. */
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
			<p id="status">driving the fullscreen transition…</p>
		</main>
		<script src="/app.js"></script>
	</body>
</html>
`;
