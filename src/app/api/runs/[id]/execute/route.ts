import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { executeRun } from "@/lib/runs/executor";
import { getRun } from "@/lib/runs/queries";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/runs/[id]/execute
 *
 * Kicks off execution for a pending run. Returns 202 immediately and does
 * the actual work in Vercel's `after()` hook so the HTTP response isn't
 * blocked by model latency.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "pending") {
    return NextResponse.json({
      ok: true,
      skipped: `run status is ${run.status}`,
    });
  }

  after(async () => {
    await executeRun(id);
  });

  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
