import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BlogPostRedirect({ params }: Props) {
  const { slug } = await params;
  redirect(`/artigos/${slug}`);
}
