"use client";

import { useState, type FormEvent } from "react";
import { cn } from "@/lib/utils";

type ZipResult =
  | { ok: true; shortUrl: string; originalUrl: string }
  | { ok: false; error: string };

const inputClass =
  "w-full border-[3px] border-black bg-white px-4 py-3 font-mono text-sm shadow-nb-sm outline-none transition-shadow focus:shadow-nb";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ZipForm() {
  const [result, setResult] = useState<ZipResult | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleCopy(shortUrl: string) {
    const success = await copyText(shortUrl);
    if (success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult(null);
    setCopied(false);

    const formData = new FormData(event.currentTarget);
    const url = String(formData.get("url") ?? "").trim();

    try {
      const response = await fetch("/api/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      const data = (await response.json()) as ZipResult;
      setResult(data);

      if (data.ok) {
        await handleCopy(data.shortUrl);
      }
    } catch {
      setResult({
        ok: false,
        error: "Erro ao encurtar a URL. Tente novamente.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-2 block font-mono text-xs font-bold uppercase tracking-widest">
            URL original
          </span>
          <input
            type="url"
            name="url"
            required
            placeholder="https://exemplo.com/pagina"
            className={inputClass}
            disabled={pending}
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className={cn(
            "w-full border-[3px] border-black bg-nb-secondary px-6 py-3 font-bold shadow-nb transition-all duration-150",
            "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb-lg",
            "active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {pending ? "Zipando…" : "Zipar URL"}
        </button>
      </form>

      {result?.ok === false && (
        <p
          role="alert"
          className="mt-4 border-[3px] border-black bg-nb-danger px-4 py-3 font-mono text-sm font-bold shadow-nb-sm"
        >
          {result.error}
        </p>
      )}

      {result?.ok === true && (
        <div className="mt-6 animate-slide-up border-[3px] border-black bg-nb-success p-4 shadow-nb">
          <div className="flex items-start justify-between gap-3">
            <p className="font-mono text-xs font-bold uppercase tracking-widest">
              URL zipada
            </p>
            {copied && (
              <span className="font-mono text-xs font-bold uppercase tracking-wider">
                Copiado!
              </span>
            )}
          </div>
          <a
            href={result.shortUrl}
            className="mt-2 block break-all font-mono text-sm font-bold underline underline-offset-2"
          >
            {result.shortUrl}
          </a>
          <button
            type="button"
            onClick={() => handleCopy(result.shortUrl)}
            className={cn(
              "mt-4 border-[3px] border-black bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider shadow-nb-sm transition-all duration-150",
              "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb",
              "active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
            )}
          >
            Copiar URL
          </button>
          <p className="mt-3 text-xs text-nb-muted">
            Original:{" "}
            <span className="break-all font-mono">{result.originalUrl}</span>
          </p>
        </div>
      )}
    </div>
  );
}
