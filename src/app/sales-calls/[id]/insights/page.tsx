import { notFound, redirect } from "next/navigation";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrgContext } from "@/lib/auth/admin";
import type { SalesCallInsights } from "@/lib/sales-calls/extract-insights";
import { supabaseAdmin } from "@/lib/supabase/server";

import { SendToManagerButton } from "./SendToManagerButton";

export const dynamic = "force-dynamic";

type SalesCallRow = {
  id: string;
  filename: string | null;
  status: string;
  analyzed_at: string | null;
  insights: SalesCallInsights | null;
  objections: string[] | null;
  pain_points: string[] | null;
  buying_signals: string[] | null;
};

const EMPTY: SalesCallInsights = {
  objections: [],
  painPoints: [],
  buyingSignals: [],
  stuckPoints: [],
  productFitGaps: [],
  suggestedActions: [],
};

function ListCard({
  title,
  items,
  emptyHint,
}: {
  title: string;
  items: string[];
  emptyHint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {items.map((it, i) => (
              <li key={`${title}-${i}`}>{it}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function SalesCallInsightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getOrgContext();
  if (!ctx?.activeOrgId) redirect("/auth/signin");
  const { id } = await params;

  const { data } = await supabaseAdmin()
    .from("rgaios_sales_calls")
    .select(
      "id, filename, status, analyzed_at, insights, objections, pain_points, buying_signals",
    )
    .eq("id", id)
    .eq("organization_id", ctx.activeOrgId)
    .maybeSingle();
  const row = data as SalesCallRow | null;
  if (!row) notFound();

  const insights: SalesCallInsights = row.insights ?? {
    ...EMPTY,
    objections: row.objections ?? [],
    painPoints: row.pain_points ?? [],
    buyingSignals: row.buying_signals ?? [],
  };

  const pending = !row.analyzed_at;

  return (
    <PageShell
      title={row.filename ?? "Sales call"}
      description={
        pending
          ? "Insights are still being extracted. Refresh in a few seconds."
          : "Structured insights extracted from the transcript."
      }
    >
      {pending ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The transcript landed but the LLM has not analyzed it yet.
              Background extraction runs after upload; this page will
              populate on the next refresh.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ListCard
            title="Top objections"
            items={insights.objections}
            emptyHint="No objections detected."
          />
          <ListCard
            title="Pain points"
            items={insights.painPoints}
            emptyHint="No pain points detected."
          />
          <ListCard
            title="Buying signals"
            items={insights.buyingSignals}
            emptyHint="No buying signals detected."
          />
          <ListCard
            title="Stuck points"
            items={insights.stuckPoints}
            emptyHint="No stuck points detected."
          />
          <ListCard
            title="Product-fit gaps"
            items={insights.productFitGaps}
            emptyHint="No product-fit gaps detected."
          />
          <Card>
            <CardHeader>
              <CardTitle>Suggested follow-ups</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {insights.suggestedActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No follow-ups suggested.
                </p>
              ) : (
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  {insights.suggestedActions.map((it, i) => (
                    <li key={`action-${i}`}>{it}</li>
                  ))}
                </ul>
              )}
              <SendToManagerButton
                salesCallId={row.id}
                actions={insights.suggestedActions}
                callTitle={row.filename ?? "Sales call"}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
