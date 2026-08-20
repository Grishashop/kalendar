import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "./env";
import { getSnapshot, verdictForPath } from "../access";
import { loadSnapshot } from "../access-db";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip middleware check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // Разделы «Маркет», «Карман» и «Тикеры» закрыты режимом доступа, который
  // администратор правит в базе (docs/adr/0011-dostup-k-razdelam-v-middleware.md).
  // Проверка идёт раньше общего правила входа: у «Маркета» есть публичный режим,
  // и общее правило про него ничего не знает.
  const pathname = request.nextUrl.pathname;
  const email = typeof user?.email === "string" ? user.email : null;
  const pages = verdictForPath(
    await getSnapshot(() => loadSnapshot(supabase)),
    pathname,
    email,
  );

  if (pages.page !== null) {
    if (pages.verdict === "allow") return supabaseResponse;

    const url = request.nextUrl.clone();
    url.search = "";
    if (pages.verdict === "needLogin") {
      // Анониму нужен вход, а не доступ: ведём на главную, где живёт кнопка
      // «Войти», существующим механизмом.
      url.pathname = "/";
      url.searchParams.set("loginRequired", pathname);
    } else {
      // Вошедшему вход не поможет. Ведём в его рабочее пространство, а не на
      // «/»: главная всё равно перебросила бы его туда, дав два прыжка.
      url.pathname = "/protected";
      url.searchParams.set("accessDenied", pages.page);
    }
    return NextResponse.redirect(url);
  }

  if (
    pathname !== "/" &&
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth") &&
    !pathname.startsWith("/temp-calendar") &&
    !pathname.startsWith("/api/temp-calendar") &&
    // Календарь дежурств отдела поддержки: у них нет аккаунтов в kalendar,
    // вход на страницу — по паролю самого календаря, как и у трейдерского.
    !pathname.startsWith("/support-calendar") &&
    !pathname.startsWith("/api/support-calendar") &&
    // Статическая презентация «Маркета» для коллег — публичная ссылка,
    // без входа (public/presentation/index.html), вне механизма доступа.
    !pathname.startsWith("/presentation")
  ) {
    // no user — отправляем на главную (просмотровый режим),
    // а не на форму входа. Логин доступен по кнопке "Войти".
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("loginRequired", pathname);
    return NextResponse.redirect(url);
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
