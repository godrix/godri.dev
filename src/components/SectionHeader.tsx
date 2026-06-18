type SectionHeaderProps = {
  label: string;
  title: string;
  description?: string;
};

export function SectionHeader({ label, title, description }: SectionHeaderProps) {
  return (
    <div className="mb-8 border-b-[3px] border-black pb-6">
      <p className="mb-2 font-mono text-xs font-bold uppercase tracking-widest">
        {label}
      </p>
      <h2 className="font-display text-3xl font-black tracking-tight sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 max-w-2xl text-base leading-relaxed">{description}</p>
      )}
    </div>
  );
}
