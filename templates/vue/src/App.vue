<script setup lang="ts">
import { onMounted, ref } from "vue";

type Answer = { text: string; ok: boolean } | null;

/**
 * Dark by default, readable on light: one inline palette chosen from
 * prefers-color-scheme, so the template ships no stylesheet.
 */
const light = window.matchMedia("(prefers-color-scheme: light)").matches;
const colors = light
	? { bg: "#fafafa", panel: "#ffffff", line: "#e2e4e8", text: "#1b1d21", muted: "#5f646c", ok: "#3f7a1f", bad: "#b4232f" }
	: { bg: "#0e0f11", panel: "#17191c", line: "#25292e", text: "#e8eaed", muted: "#9aa0a6", ok: "#9ece6a", bad: "#f7768e" };
const mono = "ui-monospace, 'SF Mono', SFMono-Regular, monospace";
const sans = "system-ui, -apple-system, 'SF Pro Text', sans-serif";

const answer = ref<Answer>(null);

onMounted(() => {
	window.crust
		.invoke("greet", { name: "vue" })
		.then((value) => {
			answer.value = { text: String(value), ok: true };
		})
		.catch((error: unknown) => {
			answer.value = {
				text: error instanceof Error ? error.message : String(error),
				ok: false,
			};
		});
});
</script>

<template>
	<main
		:style="`display:grid;place-items:center;min-height:100vh;padding:32px 24px;box-sizing:border-box;background:${colors.bg};color:${colors.text};font-family:${sans};font-size:15px;line-height:1.55`"
	>
		<section
			:style="`width:min(560px,100%);padding:32px;border:1px solid ${colors.line};border-radius:14px;background:${colors.panel}`"
		>
			<p
				:style="`margin:0 0 10px;color:${colors.muted};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase`"
			>
				crust + vue
			</p>
			<h1 :style="`margin:0 0 12px;font-size:26px;letter-spacing:-0.02em`">
				Window, bridge, handler.
			</h1>
			<p :style="`margin:0 0 22px;color:${colors.muted}`">
				This page was built by Vite, embedded in the app bundle, and served by the
				bridge. The line below is the backend's answer.
			</p>
			<p
				:style="`margin:0;padding:14px 16px;border:1px solid ${colors.line};border-radius:9px;background:${colors.bg};font-family:${mono};font-size:13px;color:${answer === null ? colors.muted : answer.ok ? colors.ok : colors.bad}`"
				aria-live="polite"
			>
				{{ answer === null ? "asking the backend…" : answer.text }}
			</p>
		</section>
	</main>
</template>
