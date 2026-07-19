import type { Metadata, Viewport } from "next";
import "./eink.css";

export const metadata: Metadata = {
  title: "eink",
  robots: { index: false, follow: false },
};

/** Lock scale to device width — Paperwhite viewport ≈ 758×899 with chrome. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function EinkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
