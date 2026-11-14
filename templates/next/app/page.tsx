"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** The page-side bridge the crust window injects; only what this page touches. */
interface CrustInvoke {
	invoke(name: string, args?: Record<string, unknown>): Promise<unknown>;
	baseUrl?: string;
}

declare global {
	interface Window {
		crust?: CrustInvoke;
	}
}

export default function Page() {
	const [answer, setAnswer] = useState("asking the backend…");
	const [status, setStatus] = useState('window.crust.invoke("greet", { name: "crust" })');

	// After mount, never during render: the export is static, and the bridge is
	// only reachable from a client.
	useEffect(() => {
		const crust = window.crust;
		if (!crust) {
			setAnswer("no bridge");
			setStatus("window.crust is not installed in this page");
			return;
		}

		let live = true;
		crust
			.invoke("greet", { name: "crust" })
			.then((greeting) => {
				if (!live) return;
				setAnswer(String(greeting));
				setStatus(`answered over the bridge · ${crust.baseUrl ?? "unknown origin"}`);
			})
			.catch((error: unknown) => {
				if (!live) return;
				setAnswer("invoke failed");
				setStatus(error instanceof Error ? error.message : String(error));
			});

		return () => {
			live = false;
		};
	}, []);

	return (
		<div style={{ display: "grid", gap: 10 }}>
			<h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, letterSpacing: "0.02em" }}>
				{"{{name_text}}"}
			</h1>
			<p style={{ margin: 0, minHeight: "1.5em", color: "LinkText" }}>{answer}</p>
			<p style={{ margin: 0, fontSize: 12, color: "GrayText" }}>{status}</p>
			<Link href="/about" style={{ fontSize: 13 }}>
				another page →
			</Link>
		</div>
	);
}
