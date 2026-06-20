"use client";

import { useCallback, useState } from "react";
import { PixQrImage, PixQrModal } from "@/components/PixQrModal";
import {
  ANIVERSARIO_PIX_COPIA_COLA,
  ANIVERSARIO_QR_CODE_IMAGE,
} from "@/data/aniversario";
import { cn } from "@/lib/utils";

type AniversarioPixProps = {
  variant?: "card" | "inline";
  className?: string;
};

const buttonBase =
  "border-2 border-black font-bold transition-all duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none";

export function AniversarioPix({
  variant = "card",
  className,
}: AniversarioPixProps) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const copyPix = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ANIVERSARIO_PIX_COPIA_COLA);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  const closeQr = useCallback(() => setQrOpen(false), []);

  const actions = (
    <div className="flex max-w-full flex-wrap gap-2">
      <button
        type="button"
        onClick={copyPix}
        className={cn(
          buttonBase,
          "bg-nb-accent px-4 py-2 text-sm shadow-nb hover:shadow-nb-lg",
          copied && "bg-nb-success"
        )}
      >
        {copied ? "Copiado!" : "Copiar Pix"}
      </button>
      <button
        type="button"
        onClick={() => setQrOpen(true)}
        className={cn(
          buttonBase,
          "bg-white px-4 py-2 text-sm shadow-nb hover:shadow-nb-lg"
        )}
      >
        Ver QR Code
      </button>
    </div>
  );

  return (
    <>
      {variant === "card" ? (
        <div
          className={cn(
            "min-w-0 border-2 border-black bg-nb-accent p-4 shadow-nb",
            className
          )}
        >
          <span className="block font-display text-base font-bold leading-tight sm:text-lg">
            Aniversário chegando 🎂
          </span>
          <span className="mt-1 block text-sm font-medium opacity-80">
            Pix presente — valor livre
          </span>
          <div className="mt-3">{actions}</div>
        </div>
      ) : (
        <div className={cn("flex min-w-0 flex-col gap-2", className)}>
          <p className="font-bold">Aniversário chegando 🎂</p>
          {actions}
        </div>
      )}

      <PixQrModal
        open={qrOpen}
        onClose={closeQr}
        title="Pix — Aniversário"
        subtitle="Escaneie para presentear"
        footer="Valor livre · Carlos G Godri"
      >
        <PixQrImage
          src={ANIVERSARIO_QR_CODE_IMAGE}
          alt="QR Code Pix de aniversário"
        />
      </PixQrModal>
    </>
  );
}
