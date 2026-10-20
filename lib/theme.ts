import { cookies } from "next/headers";

/** Default mode terang; mode gelap hanya kalau user memilihnya (disimpan di cookie). */
export async function getTheme(): Promise<"light" | "dark"> {
  return (await cookies()).get("theme")?.value === "dark" ? "dark" : "light";
}
