"use client";

import { Command, CommandInput, CommandItem, CommandList } from "@ui-sdk/react/command";
import {
	createDialogController,
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@ui-sdk/react/dialog";
import { useShortcut, useShortcutHint } from "@ui-sdk/react/shortcuts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { searchPages } from "@/lib/search";

/**
 * ui-sdk fires Command/Control shortcuts even while a text field has focus, so the
 * palette's own keys are refused there; otherwise typing ⌘K into any input on the
 * page would open it.
 */
function isTextField(element: Element | null): boolean {
	if (element === null) return false;
	return (
		element.tagName === "INPUT" ||
		element.tagName === "TEXTAREA" ||
		(element as HTMLElement).isContentEditable
	);
}

/**
 * ⌘K palette over the navigation. The dialog supplies the top layer, focus trap and
 * focus return; `Command` supplies filtering, the arrow-key highlight and ARIA, while
 * `lib/search.ts` decides which pages exist so the palette and the rail never diverge.
 */
export function Palette() {
	const router = useRouter();
	const [palette] = useState(() => createDialogController());
	const [query, setQuery] = useState("");
	const hint = useShortcutHint("mod+k");
	const pages = searchPages(query);

	useShortcut("mod+k", () => void palette.open(), {
		when: () => !isTextField(document.activeElement),
		description: "Search the docs",
	});

	return (
		<div className="palette-mount">
			<DialogTrigger
				controller={palette}
				className="palette-trigger"
				aria-keyshortcuts={hint.ariaKeyshortcuts}
			>
				Search
				<kbd aria-hidden="true">{hint.text}</kbd>
			</DialogTrigger>
			<Dialog
				controller={palette}
				onOpenChange={(open) => {
					if (!open) setQuery("");
				}}
			>
				<DialogContent
					className="palette"
					onKeyDownCapture={(event) => {
						// Command clears the search on Escape; a palette should leave instead.
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						palette.close();
					}}
				>
					<div className="palette-head">
						<DialogTitle className="palette-title">Search the docs</DialogTitle>
						<kbd className="palette-kbd">esc</kbd>
					</div>
					<Command
						filter={false}
						query={query}
						onQueryChange={(next) => setQuery(next)}
						autoHighlight
						loop
						onAction={(href) => {
							setQuery("");
							palette.close();
							router.push(href);
						}}
					>
						<CommandInput
							className="palette-input"
							aria-label="Search the docs"
							placeholder="Jump to a page…"
						/>
						<CommandList className="palette-list">
							{pages.map((page) => (
								<CommandItem
									key={page.href}
									value={page.href}
									label={page.label}
									className="palette-item"
								>
									<span>{page.label}</span>
									<span className="palette-group">{page.group}</span>
								</CommandItem>
							))}
						</CommandList>
					</Command>
					<p className="palette-empty" hidden={pages.length > 0} role="status">
						No page matches that.
					</p>
					<div className="palette-foot">
						<span>↑↓ move</span>
						<span>↵ open</span>
						<span>esc close</span>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
