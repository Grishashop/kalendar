import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Image from "next/image";

export const runtime = 'edge';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center">
          <Image
            src="/logo.png"
            alt="Lavochka 2.0"
            width={120}
            height={40}
            className="h-8 w-auto object-contain mb-6"
            priority
          />
          <div className="flex flex-col gap-6 w-full">
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">
                  Извините, что-то пошло не так.
                </CardTitle>
              </CardHeader>
              <CardContent>
                {params?.error ? (
                  <p className="text-sm text-muted-foreground">
                    Код ошибки: {params.error}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Произошла неопределенная ошибка.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
