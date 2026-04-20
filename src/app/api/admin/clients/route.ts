import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/auth/admin";
import { createClient, listClients } from "@/lib/clients/queries";
import { isSelfHosted } from "@/lib/deploy-mode";

export const runtime = "nodejs";

async function requireAdmin() {
  // Self-hosted VPSs are single-tenant. Multi-client admin endpoints
  // are meaningless here and are hard-disabled.
  if (isSelfHosted) return null;
  const ctx = await getOrgContext();
  if (!ctx?.isAdmin) {
    return null;
  }
  return ctx;
}

export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const clients = await listClients();
    return NextResponse.json({ clients });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = (await req.json()) as {
      name?: string;
      ownerEmail?: string;
      ownerName?: string;
      ownerPassword?: string;
    };
    const result = await createClient({
      name: body.name ?? "",
      ownerEmail: body.ownerEmail ?? "",
      ownerName: body.ownerName,
      ownerPassword: body.ownerPassword ?? "",
    });
    return NextResponse.json({ client: result }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
