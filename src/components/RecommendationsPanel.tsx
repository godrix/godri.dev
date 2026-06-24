"use client";

import { useCallback, useEffect, useState } from "react";
import {
  linkTagLabels,
  type LinkItem,
  type LinkTag,
} from "@/data/links";
import { cn } from "@/lib/utils";

type RecommendationRecord = LinkItem & { dbId: number; sortOrder: number };

type FormState = {
  label: string;
  description: string;
  url: string;
  tag: LinkTag | "";
  color: LinkItem["color"];
  slug: string;
  sortOrder: number;
};

const emptyForm = (): FormState => ({
  label: "",
  description: "",
  url: "",
  tag: "",
  color: "primary",
  slug: "",
  sortOrder: 0,
});

const inputClass =
  "w-full border-[3px] border-black bg-white px-3 py-2 font-mono text-sm shadow-nb-sm outline-none focus:shadow-nb";

const selectClass = inputClass;

const tagOptions: { value: LinkTag | ""; label: string }[] = [
  { value: "", label: "Sem tag" },
  ...Object.entries(linkTagLabels).map(([value, label]) => ({
    value: value as LinkTag,
    label,
  })),
];

const colorOptions: { value: LinkItem["color"]; label: string }[] = [
  { value: "primary", label: "Amarelo" },
  { value: "secondary", label: "Azul" },
  { value: "accent", label: "Rosa" },
  { value: "success", label: "Verde" },
  { value: "warning", label: "Laranja" },
  { value: "white", label: "Branco" },
];

function recordToForm(record: RecommendationRecord): FormState {
  return {
    label: record.label,
    description: record.description ?? "",
    url: record.url,
    tag: record.tag ?? "",
    color: record.color,
    slug: record.id,
    sortOrder: record.sortOrder,
  };
}

export function RecommendationsPanel({ token }: { token: string }) {
  const [items, setItems] = useState<RecommendationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);

  const apiBase = `/api/links/recommendations?token=${encodeURIComponent(token)}`;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(apiBase);
      const data = (await response.json()) as {
        ok: boolean;
        items?: RecommendationRecord[];
        error?: string;
      };

      if (!data.ok || !data.items) {
        setError(data.error ?? "Erro ao carregar recomendações.");
        return;
      }

      setItems(data.items);
    } catch {
      setError("Erro ao carregar recomendações.");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm(), sortOrder: items.length });
    setShowForm(true);
    setError(null);
  }

  function startEdit(record: RecommendationRecord) {
    setEditingId(record.dbId);
    setForm(recordToForm(record));
    setShowForm(true);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(false);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      label: form.label,
      description: form.description || null,
      url: form.url,
      tag: form.tag || null,
      color: form.color,
      slug: form.slug || undefined,
      sortOrder: form.sortOrder,
    };

    try {
      const response = await fetch(
        editingId
          ? `/api/links/recommendations/${editingId}?token=${encodeURIComponent(token)}`
          : apiBase,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const data = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!data.ok) {
        setError(data.error ?? "Erro ao salvar.");
        return;
      }

      cancelEdit();
      await loadItems();
    } catch {
      setError("Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleExtractMetadata() {
    const url = form.url.trim();
    if (!url) {
      setError("Informe uma URL antes de extrair metadados.");
      return;
    }

    setExtracting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/links/metadata?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        },
      );

      const data = (await response.json()) as {
        ok: boolean;
        metadata?: { title?: string; description?: string };
        error?: string;
      };

      if (!data.ok || !data.metadata) {
        setError(data.error ?? "Não foi possível extrair metadados.");
        return;
      }

      setForm((current) => ({
        ...current,
        label: data.metadata?.title || current.label,
        description: data.metadata?.description || current.description,
      }));
    } catch {
      setError("Erro ao extrair metadados do link.");
    } finally {
      setExtracting(false);
    }
  }

  async function handleDelete(id: number, label: string) {
    if (!window.confirm(`Excluir "${label}"?`)) return;

    setError(null);

    try {
      const response = await fetch(
        `/api/links/recommendations/${id}?token=${encodeURIComponent(token)}`,
        { method: "DELETE" },
      );

      const data = (await response.json()) as { ok: boolean; error?: string };

      if (!data.ok) {
        setError(data.error ?? "Erro ao excluir.");
        return;
      }

      if (editingId === id) cancelEdit();
      await loadItems();
    } catch {
      setError("Erro ao excluir.");
    }
  }

  return (
    <div className="w-full max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs font-bold uppercase tracking-widest text-nb-muted">
          {items.length} recomendação{items.length === 1 ? "" : "ões"}
        </p>
        <button
          type="button"
          onClick={startCreate}
          className="border-[3px] border-black bg-nb-success px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider shadow-nb-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb"
        >
          Nova recomendação
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="border-[3px] border-black bg-nb-danger px-4 py-3 font-mono text-sm font-bold shadow-nb-sm"
        >
          {error}
        </p>
      )}

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 border-[3px] border-black bg-white p-4 shadow-nb"
        >
          <h2 className="font-display text-xl font-black">
            {editingId ? "Editar recomendação" : "Nova recomendação"}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block font-mono text-xs font-bold uppercase">
                URL
              </span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  required
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://... ou /quero-cafe"
                  className={cn(inputClass, "sm:flex-1")}
                />
                <button
                  type="button"
                  onClick={() => void handleExtractMetadata()}
                  disabled={extracting || !form.url.trim()}
                  className={cn(
                    "shrink-0 border-[3px] border-black bg-nb-warning px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider shadow-nb-sm",
                    "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                  )}
                >
                  {extracting ? "Extraindo…" : "Extrair OG"}
                </button>
              </div>
              <p className="mt-1 font-mono text-[10px] text-nb-muted">
                Preenche título e descrição a partir dos metadados do link.
              </p>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block font-mono text-xs font-bold uppercase">
                Título
              </span>
              <input
                required
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className={inputClass}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block font-mono text-xs font-bold uppercase">
                Descrição
              </span>
              <input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block font-mono text-xs font-bold uppercase">
                Tag
              </span>
              <select
                value={form.tag}
                onChange={(e) =>
                  setForm({
                    ...form,
                    tag: e.target.value as LinkTag | "",
                  })
                }
                className={selectClass}
              >
                {tagOptions.map((option) => (
                  <option key={option.value || "none"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block font-mono text-xs font-bold uppercase">
                Cor
              </span>
              <select
                value={form.color}
                onChange={(e) =>
                  setForm({
                    ...form,
                    color: e.target.value as LinkItem["color"],
                  })
                }
                className={selectClass}
              >
                {colorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block font-mono text-xs font-bold uppercase">
                Slug
              </span>
              <input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="auto a partir do título"
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="mb-1 block font-mono text-xs font-bold uppercase">
                Ordem
              </span>
              <input
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sortOrder: Number(e.target.value),
                  })
                }
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className={cn(
                "border-[3px] border-black bg-nb-secondary px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider shadow-nb-sm",
                "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {saving ? "Salvando…" : editingId ? "Salvar" : "Criar"}
            </button>
            {(editingId !== null || showForm) && (
              <button
                type="button"
                onClick={cancelEdit}
                className="border-[3px] border-black bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider shadow-nb-sm"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <p className="font-mono text-sm">Carregando…</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.dbId}
              className="border-[3px] border-black bg-nb-bg-secondary p-4 shadow-nb-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold">{item.label}</p>
                  {item.description && (
                    <p className="mt-1 text-sm opacity-80">{item.description}</p>
                  )}
                  <p className="mt-2 break-all font-mono text-xs">{item.url}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-nb-muted">
                    #{item.sortOrder} · {item.id}
                    {item.tag ? ` · ${item.tag}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    className="border-2 border-black bg-white px-3 py-1 font-mono text-[10px] font-bold uppercase"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(item.dbId, item.label)}
                    className="border-2 border-black bg-nb-danger px-3 py-1 font-mono text-[10px] font-bold uppercase"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
