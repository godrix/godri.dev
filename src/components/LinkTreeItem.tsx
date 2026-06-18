import { LinkItem } from "@/data/links";
import { cn, nbColorClass } from "@/lib/utils";

type LinkTreeItemProps = {
  link: LinkItem;
};

export function LinkTreeItem({ link }: LinkTreeItemProps) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group block w-full border-2 border-black p-4 shadow-nb transition-all duration-150 ease-out",
        "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-nb-lg",
        "active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        nbColorClass(link.color)
      )}
    >
      <span className="block font-display text-base font-bold leading-tight sm:text-lg">
        {link.label}
      </span>
      {link.description && (
        <span className="mt-1 block text-sm font-medium opacity-80 group-hover:opacity-100">
          {link.description}
        </span>
      )}
    </a>
  );
}
