import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
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
  );
}
