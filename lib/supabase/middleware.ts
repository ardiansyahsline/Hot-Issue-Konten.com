import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { EMAIL_HEADER, UID_HEADER } from "@/lib/authHeaders";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // getClaims: verifikasi JWT (lokal kalau project pakai asymmetric signing key) + refresh session
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims?.sub ? data.claims : null;

  const isLogin = request.nextUrl.pathname.startsWith("/login");

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Percepat: teruskan user yang SUDAH diverifikasi ke halaman lewat header internal,
  // jadi server tidak perlu cek login ke Supabase untuk kedua kalinya.
  // Header kiriman dari luar selalu dibuang dulu supaya tidak bisa dipalsukan.
  const headers = new Headers(request.headers);
  headers.delete(UID_HEADER);
  headers.delete(EMAIL_HEADER);
  if (user) {
    headers.set(UID_HEADER, String(user.sub));
    headers.set(EMAIL_HEADER, encodeURIComponent(String(user.email ?? "")));
  }
  const final = NextResponse.next({ request: { headers } });
  response.cookies.getAll().forEach((c) => final.cookies.set(c));
  return final;
}
