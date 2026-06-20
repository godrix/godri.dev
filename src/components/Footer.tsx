import Link from "next/link";
import { FooterApoio } from "@/components/FooterApoio";

export function Footer() {
  return (
    <footer className="mt-auto border-t-[3px] border-black bg-nb-bg-secondary">
      <div className="mx-auto max-w-[var(--nb-max-width)] px-6 py-8">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 border-b-2 border-black pb-6 sm:flex-row sm:items-center">
          <p className="font-mono text-sm font-bold uppercase tracking-wider">
            © {new Date().getFullYear()} godri.dev
          </p>
          <Link
            href="/links"
            className="font-bold underline-offset-4 hover:underline"
          >
            Links →
          </Link>
        </div>
        <FooterApoio />
      </div>
    </footer>
  );
}
