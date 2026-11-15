"use client";

import {
	Accordion as AccordionRoot,
	AccordionHeader,
	AccordionItem as Item,
	AccordionPanel,
	AccordionTrigger,
} from "@ui-sdk/react/accordion";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import "./content.css";

interface ItemProps {
	title: string;
	children?: ReactNode;
}

/** MDX writes <Accordion><AccordionItem title="Distribution">…</AccordionItem></Accordion>. */
export function AccordionItem({ children }: ItemProps) {
	return <>{children}</>;
}

function isItem(child: ReactNode): child is ReactElement<ItemProps> {
	return isValidElement(child) && typeof (child.props as ItemProps).title === "string";
}

function valueOf(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

/** Several groups stay open at once: a reference page is read across, not one at a time. */
export function Accordion({ children }: { children?: ReactNode }) {
	const items = Children.toArray(children).filter(isItem);
	return (
		<AccordionRoot multiple hiddenUntilFound>
			{items.map((item) => (
				<Item key={item.props.title} value={valueOf(item.props.title)}>
					<AccordionHeader>
						<AccordionTrigger>
							{item.props.title}
							<span className="accordion-marker" aria-hidden="true" />
						</AccordionTrigger>
					</AccordionHeader>
					<AccordionPanel>{item.props.children}</AccordionPanel>
				</Item>
			))}
		</AccordionRoot>
	);
}
