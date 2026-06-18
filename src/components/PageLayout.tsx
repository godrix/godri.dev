import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export function PageLayout({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <Header />
      <main className={className ?? "flex-1"}>{children}</main>
      <Footer />
    </>
  );
}
