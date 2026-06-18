import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-auto border-t-[3px] border-black bg-nb-bg-secondary">
      <div className="mx-auto flex max-w-[var(--nb-max-width)] flex-col items-start justify-between gap-4 px-6 py-8 sm:flex-row sm:items-center">
        <p className="font-mono text-sm font-bold uppercase tracking-wider">
          © {new Date().getFullYear()} godri.dev
        </p>
        <div className="flex gap-4">
          <Link
            href="#"
            aria-disabled="true"
            className="pointer-events-none font-bold underline-offset-4 opacity-50"
          >
            GitHub
          </Link>
          <Link
            href="#"
            aria-disabled="true"
            className="pointer-events-none font-bold underline-offset-4 opacity-50"
          >
            Twitter
          </Link>
        </div>
      </div>
    </footer>
  );
}
