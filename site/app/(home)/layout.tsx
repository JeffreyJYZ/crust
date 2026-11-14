import type { ReactNode } from "react";
import "./home.css";

export default function HomeLayout({ children }: { children: ReactNode }) {
	return <div className="home">{children}</div>;
}
