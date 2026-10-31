import type { Metadata } from "next";

// The page is a client component, so its title lives here (WCAG 2.4.2 Page Titled).
export const metadata: Metadata = { title: "First Steps" };

export default function Layout({ children }: LayoutProps<"/steps">) {
  return children;
}
