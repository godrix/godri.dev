import {
  PortfolioItem,
  kindLabels,
  kindColors,
  PortfolioStatus,
} from "@/data/portfolio";
import { Card } from "./Card";
import { Badge } from "./Badge";

const statusLabels: Record<PortfolioStatus, string> = {
  publicado: "Publicado",
  "em-progresso": "Em progresso",
  planejado: "Planejado",
};

const statusColors: Record<
  PortfolioStatus,
  "success" | "warning" | "secondary"
> = {
  publicado: "success",
  "em-progresso": "warning",
  planejado: "secondary",
};

export function PortfolioCard({ item }: { item: PortfolioItem }) {
  return (
    <Card color={item.color} className="flex h-full flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <Badge color={kindColors[item.kind]}>{kindLabels[item.kind]}</Badge>
        <span className="shrink-0 font-mono text-xs font-bold">{item.year}</span>
      </div>

      <h3 className="mb-1 font-display text-xl font-bold leading-tight">
        {item.title}
      </h3>

      {item.subtitle && (
        <p className="mb-2 text-sm font-semibold opacity-80">{item.subtitle}</p>
      )}

      <p className="mb-4 flex-1 text-sm leading-relaxed">{item.description}</p>

      {item.tags && item.tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <Badge key={tag} color="white">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {item.status && (
        <div className="mb-4">
          <Badge color={statusColors[item.status]}>
            {statusLabels[item.status]}
          </Badge>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t-2 border-black pt-4">
        {item.pages !== undefined && item.pages > 0 && (
          <span className="font-mono text-xs font-bold">{item.pages} págs</span>
        )}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold underline-offset-4 hover:underline"
          >
            {item.kind === "livro" ? "Ler →" : "Ver →"}
          </a>
        )}
        {item.github && (
          <a
            href={item.github}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold underline-offset-4 hover:underline"
          >
            GitHub →
          </a>
        )}
      </div>
    </Card>
  );
}
