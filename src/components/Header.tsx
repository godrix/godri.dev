"use client";

import { NavLink } from "@/components/AnimatedLink";
import { SiteLogoLink } from "@/components/SiteLogoLink";

const links = [
  { href: "/projetos", label: "Projetos", sectionId: "projetos" },
  { href: "/artigos", label: "Artigos", sectionId: "artigos" },
  { href: "/palestras", label: "Palestras", sectionId: "palestras" },
];

export function Header() {
  return (
    <header className="border-b-[3px] border-black bg-white">
      <div className="mx-auto flex max-w-[var(--nb-max-width)] items-center justify-between px-6 py-4">
        <SiteLogoLink />

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
