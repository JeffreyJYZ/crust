import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/base.css";
import "./styles/sidebar.css";
import "./styles/editor.css";
import "./styles/status.css";

const container = document.getElementById("root");
if (!container) throw new Error("dogear: index.html has no #root element");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
