"use client";

import { Tabs as TabsRoot, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import "./content.css";

interface PanelProps {
	label: string;
	children?: ReactNode;
}

/** MDX writes <Tabs label="Install"><TabPanel label="Homebrew">…</TabPanel></Tabs>; a panel's label is its tab. */
function TabPanel({ children }: PanelProps) {
	return <>{children}</>;
}

function isPanel(child: ReactNode): child is ReactElement<PanelProps> {
	return isValidElement(child) && typeof (child.props as PanelProps).label === "string";
}

/** The label is the tab text and the item value, so one name cannot say two things. */
function valueOf(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export function Tabs({ label, children }: { label: string; children?: ReactNode }) {
	const panels = Children.toArray(children).filter(isPanel);
	return (
		<TabsRoot hiddenUntilFound>
			<TabsList aria-label={label}>
				{panels.map((panel) => (
					<TabsTab key={panel.props.label} value={valueOf(panel.props.label)}>
						{panel.props.label}
					</TabsTab>
				))}
			</TabsList>
			{panels.map((panel) => (
				<TabsPanel key={panel.props.label} value={valueOf(panel.props.label)}>
					{panel.props.children}
				</TabsPanel>
			))}
		</TabsRoot>
	);
}

export { TabPanel };
