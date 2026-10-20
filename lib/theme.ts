import { cookies } from "next/headers";

export async function getTheme(): Promise<"light" | "dark"> {
  return (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
}
