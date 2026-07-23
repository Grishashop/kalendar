import Image from "next/image";
import { SignUpForm } from "@/components/sign-up-form";

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
          <SignUpForm className="w-full" />
        </div>
      </div>
    </div>
  );
}
