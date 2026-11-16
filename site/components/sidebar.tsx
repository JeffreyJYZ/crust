"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import {
	Dialog,
	DialogBackdrop,
	DialogClose,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@ui-sdk/react/dialog";
import { useState } from "react";
import { NAV } from "@/lib/nav";

interface NavGroupsProps {
	path: string;
	/** The drawer closes when a link is pressed; the rail passes nothing. */
	onNavigate?: () => void;
}

function NavGroups({ path, onNavigate }: NavGroupsProps) {
	return (
		<>
			{NAV.map((group) => (
				<Collapsible key={group.label} defaultOpen>
					<CollapsibleTrigger>{group.label}</CollapsibleTrigger>
					<CollapsiblePanel>
						<ul>
							{group.items.map((item) => (
								<li key={item.href}>
									<Link
										href={item.href}
										aria-current={path === item.href ? "page" : undefined}
										onClick={onNavigate}
									>
										{item.label}
									</Link>
								</li>
							))}
						</ul>
					</CollapsiblePanel>
				</Collapsible>
			))}
		</>
	);
}

/**
 * One navigation rendered twice: the sticky rail from 900px up, and a Dialog drawer below it. Both
 * are always in the page so neither width needs script to lay out, and the drawer starts closed so
 * the first client render matches the server's.
 */
export function Sidebar() {
	const path = usePathname();
	const [open, setOpen] = useState(false);

	return (
		<div>
			<Dialog open={open} onOpenChange={(next) => setOpen(next)}>
				<DialogTrigger className="menu-button">Menu</DialogTrigger>
				<DialogBackdrop className="drawer-backdrop" />
				<DialogContent className="drawer" initialFocus="content">
					<div className="drawer-head">
						<DialogTitle className="drawer-title">
							<Link href="/" className="brand" onClick={() => setOpen(false)}>
								crust
							</Link>
						</DialogTitle>
						<DialogClose className="drawer-close">Close</DialogClose>
					</div>
					<nav className="nav" aria-label="Documentation">
						<NavGroups path={path} onNavigate={() => setOpen(false)} />
					</nav>
				</DialogContent>
			</Dialog>
			<nav className="rail nav" aria-label="Documentation">
				<Link href="/" className="brand">
					crust
				</Link>
				<NavGroups path={path} />
			</nav>
		</div>
	);
}
