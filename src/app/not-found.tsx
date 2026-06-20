import { Button } from "@/components/Button";

const NOT_FOUND_IMAGE = "/404-back-to-future.webp";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#2d1b4e] px-6 py-16 text-center">
      <p className="mb-8 max-w-xl font-display text-2xl font-black leading-tight text-white sm:text-3xl">
        404: this page has been erased from existence
      </p>

      <div className="mb-8 w-full max-w-xl border-[3px] border-black bg-black shadow-nb-xl">
        <img
          src={NOT_FOUND_IMAGE}
          alt="Marty McFly desaparecendo — De Volta para o Futuro"
          className="block h-auto w-full"
          width={800}
          height={600}
        />
      </div>

      <Button href="/" variant="primary" className="bg-nb-primary text-black">
        Back to the <span className="line-through">future</span> início
      </Button>
    </div>
  );
}
