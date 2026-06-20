import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Livros",
};

export default function LivrosRedirect() {
  redirect("/projetos");
}
