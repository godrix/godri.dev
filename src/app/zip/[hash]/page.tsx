import { notFound, redirect } from "next/navigation";
import { getShortLink } from "@/lib/short-links";

export const dynamic = "force-dynamic";

type ZipRedirectPageProps = {
  params: Promise<{ hash: string }>;
};

export default async function ZipRedirectPage({ params }: ZipRedirectPageProps) {
  const { hash } = await params;
  const link = await getShortLink(hash);

  if (!link) {
    notFound();
  }

  redirect(link.url);
}
