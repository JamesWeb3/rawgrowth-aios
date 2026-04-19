import { NextResponse, type NextRequest } from "next/server";
import { acceptInvite, peekInvite } from "@/lib/members/queries";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  const invite = await peekInvite(token);
  if (!invite) {
    return NextResponse.json({ error: "Invalid or expired invitation" }, { status: 404 });
  }
  return NextResponse.json({ invite });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
  };
  if (!body.token || !body.password) {
    return NextResponse.json(
      { error: "Token and password are required" },
      { status: 400 },
    );
  }
  try {
    const result = await acceptInvite({
      token: body.token,
      password: body.password,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
