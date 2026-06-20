import { ComingSoonButton } from "@/components/ComingSoonButton";

export function PalestrasEmptyState() {
  return (
    <div className="border-2 border-dashed border-black bg-white/60 p-8 text-center">
      <p className="font-display text-lg font-bold sm:text-xl">
        Palestras chegando em breve
      </p>
      <p className="mt-2 text-sm font-medium opacity-70">
        Talks, eventos e slides vão aparecer aqui.
      </p>
    </div>
  );
}

export function PalestrasSectionActions() {
  return <ComingSoonButton>Ver todas →</ComingSoonButton>;
}
