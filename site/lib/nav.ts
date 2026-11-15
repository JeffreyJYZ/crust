/** The whole navigation, in the order a reader needs it. One page per entry. */
export interface NavItem {
	label: string;
	href: string;
}

export interface NavGroup {
	label: string;
	items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
	{
		label: "Start",
		items: [
			{ label: "Install", href: "/docs/start/install" },
			{ label: "First app", href: "/docs/start/first-app" },
			{ label: "Project files", href: "/docs/start/files" },
		],
	},
	{
		label: "Guides",
		items: [
			{ label: "Windows", href: "/docs/guides/window" },
			{ label: "Window state", href: "/docs/guides/window-state" },
			{ label: "Clipboard", href: "/docs/guides/clipboard" },
			{ label: "Shortcuts", href: "/docs/guides/shortcuts" },
			{ label: "Opener and OS", href: "/docs/guides/opener-and-os" },
			{ label: "Shell", href: "/docs/guides/shell" },
			{ label: "Single instance", href: "/docs/guides/single-instance" },
			{ label: "Autostart", href: "/docs/guides/autostart" },
			{ label: "Logging", href: "/docs/guides/logging" },
			{ label: "Dialogs", href: "/docs/guides/dialogs" },
			{ label: "Tray", href: "/docs/guides/tray" },
			{ label: "Notifications", href: "/docs/guides/notifications" },
			{ label: "Files", href: "/docs/guides/files" },
			{ label: "Frontend", href: "/docs/guides/frontend" },
			{ label: "Dev server", href: "/docs/guides/dev" },
			{ label: "Updater", href: "/docs/guides/updater" },
			{ label: "Packaging", href: "/docs/guides/package" },
		],
	},
	{
		label: "Reference",
		items: [
			{ label: "Config", href: "/docs/reference/config" },
			{ label: "CLI", href: "/docs/reference/cli" },
			{ label: "Imports", href: "/docs/reference/api" },
			{ label: "Parity", href: "/docs/reference/parity" },
			{ label: "Errors", href: "/docs/reference/errors" },
		],
	},
	{
		label: "Truth",
		items: [
			{ label: "Limits", href: "/docs/limits" },
			{ label: "Evidence", href: "/docs/evidence" },
		],
	},
];
