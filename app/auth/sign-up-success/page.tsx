import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import Image from "next/image";

export default function Page() {
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
                  Спасибо за регистрацию!
                </CardTitle>
                <CardDescription>Проверьте вашу почту для подтверждения</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Вы успешно зарегистрировались. Пожалуйста, проверьте вашу почту для
                  подтверждения аккаунта перед входом.
                </p>
                <div className="flex gap-3 pt-2">
                  <Button asChild variant="default" className="flex-1">
                    <Link href="/auth/login">Войти</Link>
                  </Button>
                  <Button asChild variant="outline" className="flex-1">
                    <Link href="/">Выход</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
