import { Spinner } from "@/components/ui/spinner";

export default function Loading() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Загрузка">
      <Spinner />
    </div>
  );
}
