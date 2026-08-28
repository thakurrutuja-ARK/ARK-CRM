import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session on every request and redirects
 * unauthenticated users away from protected pages. Only /login (and
 * Next internals/static assets) are reachable without a session.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Belt-and-suspenders cleanup: if the browser ever ends up on a page
  // with a leftover OAuth `code` (and its `next` companion) in the URL
  // while a session already exists, the code has already been spent —
  // it's just cosmetic clutter left in the address bar. Strip it here
  // so it never lingers, without touching /auth/callback itself (which
  // still needs `code` present to complete a fresh sign-in).
  if (
    user &&
    request.nextUrl.searchParams.has("code") &&
    !request.nextUrl.pathname.startsWith("/auth/")
  ) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("code");
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  const isPublicPath =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth/") ||
    request.nextUrl.pathname.startsWith("/forgot-password");

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
