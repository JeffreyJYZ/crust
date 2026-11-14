"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

/**
 * The rail. A client component only so the current page can be marked; the tree
 * itself is static data from `lib/nav.ts`, which is also the sitemap.
 */
export function Sidebar() {
	const path = usePathname();
	return (
		<nav className="rail" aria-label="Documentation">
			<Link href="/" className="brand">
				crust
			</Link>
			{NAV.map((group) => (
				<div key={group.label} className="group">
					<p className="label">{group.label}</p>
					<ul>
						{group.items.map((item) => (
							<li key={item.href}>
								<Link
									href={item.href}
									className={path === item.href ? "current" : undefined}
									aria-current={path === item.href ? "page" : undefined}
								>
									{item.label}
								</Link>
							</li>
						))}
					</ul>
				</div>
			))}
		</nav>
	);
}
