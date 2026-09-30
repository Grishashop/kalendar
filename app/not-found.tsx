import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Страница не найдена</h1>
      <Button asChild>
        <Link href="/">На главную</Link>
      </Button>
    </div>
  );
}
