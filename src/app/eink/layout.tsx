import type { Metadata } from "next";
import "./eink.css";

export const metadata: Metadata = {
  title: "eink",
  robots: { index: false, follow: false },
};

export default function EinkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
