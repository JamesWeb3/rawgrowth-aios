import { getOrgContext } from "@/lib/auth/admin";

export async function getCurrentOrgName(): Promise<string | null> {
  const ctx = await getOrgContext();
  return ctx?.activeOrgName ?? null;
}
