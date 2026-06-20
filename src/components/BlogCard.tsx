import { Post, formatDate } from "@/data/posts";
import { Card } from "./Card";
import { Badge } from "./Badge";

export function BlogCard({ post }: { post: Post }) {
  return (
    <Card href={`/artigos/${post.slug}`} className="flex h-full flex-col overflow-hidden p-0">
      {post.coverImage && (
        <div className="border-b-2 border-black">
          <img
            src={post.coverImage}
            alt=""
            className="h-36 w-full object-cover sm:h-40"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <time className="font-mono text-xs font-bold">{formatDate(post.date)}</time>
          <span className="font-mono text-xs">·</span>
          <span className="font-mono text-xs font-bold">{post.readTime} min</span>
        </div>

        <h3 className="mb-2 font-display text-xl font-bold leading-tight">
          {post.title}
        </h3>

        <p className="mb-4 flex-1 text-sm leading-relaxed">{post.excerpt}</p>

        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <Badge key={tag} color="accent">
              {tag}
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}
