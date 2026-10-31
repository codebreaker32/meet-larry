import type { Metadata } from "next";
import { GROUP_WORD } from "@/lib/groups/shared";

export const metadata: Metadata = { title: `Join a ${GROUP_WORD.toLowerCase()}` };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
