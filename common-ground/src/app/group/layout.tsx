import type { Metadata } from "next";
import { GROUP_WORD } from "@/lib/groups/shared";

// The pages are client components, so the title lives here (WCAG 2.4.2 Page Titled).
export const metadata: Metadata = { title: `${GROUP_WORD}s` };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
