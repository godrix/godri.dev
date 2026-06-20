"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AniversarioPix } from "@/components/AniversarioPix";
import { PixCoffee } from "@/components/PixCoffee";
import {
  ANIVERSARIO_PATH,
  isAniversarioSeason,
} from "@/data/aniversario";
import { QUERO_CAFE_PATH } from "@/data/pix";

export function FooterApoio() {
  const pathname = usePathname();
  const [showAniversario, setShowAniversario] = useState(false);

  useEffect(() => {
    setShowAniversario(pathname === "/" && isAniversarioSeason());
  }, [pathname]);

  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      {showAniversario && (
        <div className="flex flex-col gap-2">
          <AniversarioPix variant="inline" />
          <Link
            href={ANIVERSARIO_PATH}
            className="font-mono text-xs font-bold uppercase tracking-wider underline-offset-4 hover:underline"
          >
            godri.dev/aniversario →
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:items-end">
        <PixCoffee variant="inline" />
        <Link
          href={QUERO_CAFE_PATH}
          className="font-mono text-xs font-bold uppercase tracking-wider underline-offset-4 hover:underline"
        >
          godri.dev/quero-cafe →
        </Link>
      </div>
    </div>
  );
}
