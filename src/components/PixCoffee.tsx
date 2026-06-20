"use client";

import { useCallback, useState } from "react";
import { PixQrImage, PixQrModal } from "@/components/PixQrModal";
import { PIX_COPIA_COLA, PIX_QR_CODE_IMAGE } from "@/data/pix";
import { cn } from "@/lib/utils";

type PixCoffeeProps = {
  variant?: "card" | "inline";
  className?: string;
};

const buttonBase =
  "border-2 border-black font-bold transition-all duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none";

export function PixCoffee({ variant = "card", className }: PixCoffeeProps) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const copyPix = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(PIX_COPIA_COLA);
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
          "bg-nb-primary px-4 py-2 text-sm shadow-nb hover:shadow-nb-lg",
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
            "min-w-0 border-2 border-black bg-nb-warning p-4 shadow-nb",
            className
          )}
        >
          <span className="block font-display text-base font-bold leading-tight sm:text-lg">
            Me paga um café ☕
          </span>
          <span className="mt-1 block text-sm font-medium opacity-80">
            Pix copia e cola — R$ 6,00
          </span>
          <div className="mt-3">{actions}</div>
        </div>
      ) : (
        <div className={cn("flex min-w-0 flex-col gap-2 sm:items-end", className)}>
          <p className="font-bold">Me paga um café ☕</p>
          {actions}
        </div>
      )}

      <PixQrModal
        open={qrOpen}
        onClose={closeQr}
        title="Pix — QR Code"
        subtitle="Escaneie para pagar"
        footer="R$ 6,00 · Carlos G Godri"
      >
        <PixQrImage
          src={PIX_QR_CODE_IMAGE}
          alt="QR Code Pix para pagamento"
        />
      </PixQrModal>
    </>
  );
}
