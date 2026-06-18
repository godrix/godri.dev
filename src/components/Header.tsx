"use client";

import { AnimatedLink, NavLink } from "@/components/AnimatedLink";

const links = [
  { href: "/", label: "Início" },
  { href: "/portfolio", label: "Portfólio", sectionId: "portfolio" },
  { href: "/blog", label: "Blog", sectionId: "blog" },
];

export function Header() {
  return (
    <header className="border-b-[3px] border-black bg-white">
      <div className="mx-auto flex max-w-[var(--nb-max-width)] items-center justify-between px-6 py-4">
        <AnimatedLink
          href="/"
          className="font-display text-2xl font-black tracking-tight transition-colors hover:bg-nb-primary hover:px-2"
        >
          godri<span className="text-nb-accent">.</span>dev
        </AnimatedLink>

        <nav className="flex gap-1 sm:gap-2">
          {links.map((link) => (
            <NavLink
              key={link.href}
              href={link.href}
              label={link.label}
              sectionId={link.sectionId}
            />
          ))}
        </nav>
      </div>
    </header>
  );
}
