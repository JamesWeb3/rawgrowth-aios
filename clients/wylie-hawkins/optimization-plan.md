# Optimization Plan — Wylie Hawkins

**Date:** 2026-04-18
**Prepared by:** Dilan Patel (Rawgrowth)
**For:** Rawgrowth AI developer (primary build audience) + Wylie for approval
**Linked:** `constraint-report.md`, `action-plan.md`, `session-notes.md`

---

## The Answer

Of **25 processes identified** across Wylie's value stream, **8 should be automated, 0 delegated (no operator available at V1 stage), 8 systemized, 7 kept (owner + human genius zone), and 2 removed**. This recovers **~10-15 hours/week of Wylie's time** directly (less firefighting, no more manual name-reading) and **~550-700 hours/week org-wide** (replacing spreadsheet maintenance and generic group coaching with automation + AI). The one-page dashboard centres on the hero metric **"% of Agents Above $15K Issued Premium (trailing 30 days)"** — the single number that tells Wylie whether the coaching-loop constraint is actually breaking.

---

## Process Categorization Table

Sorted by Priority (1 = constraint zone first), then Category (Remove first).

| # | Process | Stage | Owner | Freq. | Time/Wk | Category | Priority | Reasoning |
|---|---|---|---|---|---|---|---|---|
| 1 | Generic Zoom Training for Bottom Performers | Sales Training | Managers | Weekly | 4-10 hrs | **REMOVE** | 1 | Fails 4 of 5 removal tests. Generic coaching against individualized failure modes. Replaced by AI personalized reports. |
| 2 | Lead Spreadsheet Maintenance | Lead Acquisition | Agents + mgrs | Daily | 50+ hrs org-wide | **REMOVE** | 1 | Fails all 5 once CRM exists. Pure overhead. |
| 3 | Call Recording & Transcription | Dialing | Nobody (doesn't exist) | Daily | 0 (automated) | **AUTOMATE** | 1 | Core missing infra. Twilio/Close + Deepgram. |
| 4 | Dialer Queue Setup per Agent | Lead Acquisition | Agents | Daily | 500+ hrs org-wide | **AUTOMATE** | 1 | Goat Leads API → CRM → rep queue. Fully rule-based. |
| 5 | Reading Names Aloud (Accountability) | Sales Training | Wylie | Ad hoc | 0.5 hrs when done | **AUTOMATE** | 1 | Replace with live leaderboard. Same lift, zero operator time. |
| 6 | Top-vs-Bottom Call Diff Analysis | Sales Training | Nobody (doesn't exist) | Weekly | 0 (automated) | **AUTOMATE** | 1 | Pure LLM job. Score 42/50 on automation gate. |
| 7 | Per-Rep Weekly Coaching Report | Sales Training | Nobody / Future AI | Weekly | Would be 700-1000 hrs manual | **AUTOMATE** | 1 | Impossible at human scale. LLM is the only option. |
| 8 | Leaderboard Maintenance | Sales Training | Nobody / Future dashboard | Real-time | 0 | **AUTOMATE** | 1 | Trivial once CRM exists. |
| 9 | Onboarding Bootcamp Delivery | Onboarding | Managers ad hoc | Weekly | 20 hrs / cohort | **SYSTEMIZE** | 1 | Needs week 1/2/3/4 milestones, graduation gates, content library. |
| 10 | Post-Call Disposition Logging | Dialing | Agents | Per call | 2-3 hrs/agent/wk | **SYSTEMIZE** | 1 | Stay with agent (context), but must move to CRM dropdown. |
| 11 | Lead History Lookup Before Dial | Dialing | Agents | Per call | Lost time × 336 agents | **SYSTEMIZE** | 1 | CRM makes this instant. "Process" becomes "look at lead card." |
| 12 | Monday-Saturday Themed Training | Sales Training | Wylie + managers | Daily | 18-36 hrs org-wide | **SYSTEMIZE** | 1 | Routine is strong; content needs to be tagged and reusable. |
| 13 | Live Dialing (Value-Add) | Dialing | Agents | Daily | 25-35 hrs/agent | **KEEP** | 1 | THE value-creating activity. Humans close insurance. |
| 14 | Daily KPI Whiteboard Ritual | Sales Training | Wylie + managers | Daily | 1.5 hrs | **KEEP** | 1 | High-morale, low-cost cultural ritual. Mirror in dashboard. |
| 15 | Agent Recruiting Intake | Recruiting | Each manager | Weekly | 10-20 hrs | **SYSTEMIZE** | 2 | Centralize intake before delegation makes sense. |
| 16 | AI Sales Simulator Practice | Sales Training | Individual rep | Ad hoc | Varies | **KEEP** | 2 | Existing asset; upgrade to voice-to-voice in V2. |
| 17 | Agent Interview & Culture-Fit | Recruiting | Managers + Wylie | Weekly | 3-8 hrs | **KEEP** | 2 | Human judgment + relational radar is the moat. |
| 18 | Lead Purchase from Goat Leads | Lead Acquisition | Agents | Daily/wkly | 1-2 hrs/agent | **SYSTEMIZE** | 2 | Stay with rep but needs lead-type SOP. |
| 19 | Office-Level 1:1s with Top Performers | Sales Training | Managers | Weekly | 5-10 hrs/mgr | **KEEP** | 2 | Retention of top performers = leverage. |
| 20 | Cross-Office Manager Sync | Ascension | Wylie | Weekly | 1 hr | **KEEP** | 2 | Owner function, cross-site alignment. |
| 21 | Agent Compensation Tracking | Ascension | Future dashboard | Monthly | 2 hrs manual today | **AUTOMATE** | 2 | Straight calc, auto-surface ascension candidates. |
| 22 | Manual Leaderboard Shout-outs | Sales Training | Wylie | Weekly | 30 min | **AUTOMATE** | 3 | LLM drafts in Wylie's voice; Wylie approves + sends. |
| 23 | Policy Application Submission | Policy Submission | Agent | Per deal | Varies | **SYSTEMIZE** | 3 | Checklist + templates cut chargebacks. |
| 24 | Post-Sale Persistency Outreach | Policy Submission | Not done | Per deal | Varies | **AUTOMATE** | 3 | SMS/email after sale. Reduces 30% cancel rate. |
| 25 | Ad-hoc Coaching Zoom Calls | Sales Training | Wylie + managers | Ad hoc | 3-5 hrs | **KEEP** | 3 | Reduce frequency as systems kick in. |

**Category totals:** Automate 8 · Delegate 0 · Systemize 8 · Keep 7 · Remove 2 · **Total: 25**

---

## Automation Plan

### A1. Call Recording & Transcription
- **Current state:** Doesn't exist. Every call on personal phones with no capture.
- **Recommended tool/approach:** Close.com (V1) or Twilio Voice (V2) → webhook to Supabase `calls` table → push audio to cloud storage → Deepgram async transcription → write back to `calls.transcript`.
- **Integration requirements:** Dialer → Supabase webhook; Deepgram API key; S3 or Supabase Storage bucket; rep identity joined via CRM user.
- **Expected time savings:** Net new capability. Zero today, 95%+ coverage within 2 weeks of launch.
- **Implementation complexity:** **Medium** (8-16 hours for integration + error handling).
- **Sequence:** First automation. Everything else depends on call data existing.

### A2. Dialer Queue Auto-Population
- **Current state:** Agents download CSVs from Goat Leads manually, work them in spreadsheets.
- **Recommended tool/approach:** Goat Leads CSV export → scheduled import → CRM `leads` table → auto-distribute to rep dialer queue by assignment rules (by office, by availability, by lead type preference).
- **Integration requirements:** Scheduled job (Vercel Cron) pulling Goat Leads export; queue assignment logic.
- **Expected time savings:** 500+ hrs/week org-wide (1.5 hrs × 336 reps).
- **Implementation complexity:** **Medium** (if Goat Leads has API) or **Hard** (if CSV-only + manual download — then need a headless scraper or human-in-the-loop upload).
- **Sequence:** Second automation. Requires CRM tables to exist.

### A3. Replace "Reading Names Aloud" with Live Leaderboard
- **Current state:** Wylie manually reads every agent's numbers on ad-hoc group calls (30 min effort, rare frequency).
- **Recommended tool/approach:** Web leaderboard component that displays monthly issued premium ranking from CRM. Live, public, visible on every device. Display in office TVs.
- **Integration requirements:** `leaderboard_snapshots` table; React component; auth gate so reps only see their org.
- **Expected time savings:** 30 min × ad hoc frequency + exponential behavioral lift.
- **Implementation complexity:** **Easy** (ships in V1.2, week 2).
- **Sequence:** Ship first — most visible win with least infra.

### A4. Top-vs-Bottom Call Diff Engine
- **Current state:** Doesn't exist. No calls are recorded.
- **Recommended tool/approach:** Nightly Vercel Workflow: load transcripts from top 59 agents, cluster success patterns; load transcripts from bottom 277, cluster failure patterns; Claude via Vercel AI Gateway generates per-rep coaching narrative.
- **Integration requirements:** Vercel Workflow DevKit for durable long-running job; Supabase RPC for transcript queries; prompt caching on the top-corpus (Anthropic 5-min TTL) to minimize cost.
- **Expected time savings:** 700-1000 hrs/week equivalent of manual review (impossible at that scale without AI).
- **Implementation complexity:** **Hard** (prompt engineering + evaluation loop + cost management).
- **Sequence:** V2, weeks 10-14. Needs 2-4 weeks of real call data first.

### A5. Per-Rep Weekly Coaching Report
- **Current state:** Doesn't exist.
- **Recommended tool/approach:** Output of A4. Delivered Monday 6 AM via email + dashboard card.
- **Integration requirements:** Email template (Resend or Postmark); dashboard inbox view; reply-capture for Q&A.
- **Expected time savings:** Net new capability.
- **Implementation complexity:** **Medium** (delivery + template).
- **Sequence:** Ships with A4.

### A6. Leaderboard Maintenance
- **Current state:** Spreadsheet reads, manual ranking.
- **Recommended tool/approach:** Real-time query on `policies` table aggregated by `agent_id` with running 30-day window.
- **Integration requirements:** Supabase view or materialized view; refresh on every policy insert.
- **Expected time savings:** ~2 hrs/week of manual aggregation.
- **Implementation complexity:** **Easy**.
- **Sequence:** Ships with V1.2 Leaderboard launch.

### A7. Manual Shout-Outs → AI-Drafted in Wylie's Voice
- **Current state:** Wylie types shout-out messages in group chats weekly.
- **Recommended tool/approach:** LLM templated on Wylie's past message style (ingest 30-50 sample messages); reads leaderboard data; drafts message; Wylie approves and sends via Slack/Discord webhook.
- **Integration requirements:** Slack/Discord incoming webhook; voice-sample corpus; approval UI.
- **Expected time savings:** ~30 min/week.
- **Implementation complexity:** **Easy**.
- **Sequence:** V2, post-coaching-loop.

### A8. Post-Sale Persistency SMS/Email
- **Current state:** Most reps don't do it. 30% cancel rate baked in.
- **Recommended tool/approach:** Triggered automation on `policies.issued_at` — day 1 welcome, day 7 check-in, day 20 pre-chargeback-cliff outreach.
- **Integration requirements:** Twilio SMS + Resend email + policy trigger.
- **Expected time savings:** Net new. If it reduces cancel rate by 2-3 points, that's material override uplift.
- **Implementation complexity:** **Medium**.
- **Sequence:** V2.5, once CRM is mature.

### A9. Agent Compensation / Ascension Candidate Surfacing
- **Current state:** Manual pulls, ~2 hrs/week.
- **Recommended tool/approach:** Dashboard widget computing each rep's current contract tier and distance-to-next-tier from trailing 30-day issued premium. Auto-flag reps within 10% of a tier jump.
- **Integration requirements:** Policies aggregation + grid rules table + UI widget.
- **Expected time savings:** ~2 hrs/week Wylie.
- **Implementation complexity:** **Medium** (grid logic).
- **Sequence:** V2, part of Owner Cockpit.

---

## Delegation Plan

**No delegations in V1 scope.** Wylie doesn't have an ops hire to delegate to. Every "owner time recovered" claim in this plan is recovered by automation + systemization, not delegation. If Wylie hires an ops lead in V2+, revisit the category for Recruiting Intake, Lead Purchase, and Agent Compensation Tracking.

---

## Systemization Requirements

### S1. Onboarding Bootcamp Delivery
- **What to create:** A 4-week sequenced onboarding track with week-by-week milestones and manager sign-off gates.
- **Who creates it:** Wylie + the manager with the best-performing onboarding cohorts (ask during validation).
- **Who uses it:** All 3 office managers; all new hires.
- **Key steps to capture:**
  - Week 1: Intake, compliance, license verification, shadow 5 top-rep calls
  - Week 2: Training Hub core modules (intro, discovery, objections, basic product knowledge)
  - Week 3: Supervised dials with manager co-listening; first 10 calls reviewed
  - Week 4: Graduation checklist sign-off; dialer access unlocked
- **Review/update frequency:** Quarterly.

### S2. Post-Call Disposition Logging
- **What to create:** Mandatory dropdown + 2-sentence notes field on every call completion. Dispositions: sold / callback / no-contact / dead / objection-price / objection-trust / objection-need / objection-time.
- **Who creates it:** Dev builds UI; Wylie + top-59 reps validate the disposition taxonomy.
- **Who uses it:** All 336 reps.
- **Key steps to capture:** Call ends → modal pops → rep selects disposition + writes 2 sentences → saves to `calls` table → can't dial next lead until saved.
- **Review/update frequency:** After first 4 weeks of data, review disposition distribution for gaps.

### S3. Lead History Lookup Before Dial
- **What to create:** Lead card UI showing all prior dispositions + notes + last contact date before the rep dials.
- **Who creates it:** Dev.
- **Who uses it:** All reps.
- **Key steps to capture:** Rep clicks lead → sees history → dials with context.
- **Review/update frequency:** N/A once built.

### S4. Monday-Saturday Themed Training
- **What to create:** Training Hub content library tagged by day-of-week theme. Mon Intro / Tue Discovery / Wed Numbers / Thu Application / Fri Hot Topic / Sat [confirm with Wylie].
- **Who creates it:** Wylie seeds with existing content + Cole Gordon materials (he said he'd send). Managers tag as content lands.
- **Who uses it:** All reps (self-serve) + managers (guide group sessions).
- **Key steps to capture:** Upload → categorize (theme, level, format) → assign to onboarding weeks if applicable → track views per rep.
- **Review/update frequency:** Monthly content audit. Retire stale content.

### S5. Agent Recruiting Intake
- **What to create:** Single centralized application form + manager pipeline view. Fields: name, contact, source, referrer, prior sales experience, why they want this.
- **Who creates it:** Dev (Typeform/Tally → Supabase).
- **Who uses it:** All managers + Wylie (owner-level view).
- **Key steps to capture:** Apply → Screened → Interviewed → Offer → Onboarding start. Source attribution required.
- **Review/update frequency:** 6-month review to look at source → outcome correlation.

### S6. Lead Purchase from Goat Leads
- **What to create:** SOP for which lead types to buy by rep experience level + current pipeline capacity. Prevents new reps burning money on IUL leads they can't close.
- **Who creates it:** Wylie + Ed (Ed has run leads before).
- **Who uses it:** Reps (especially new).
- **Key steps to capture:** Check pipeline → choose lead type per SOP → set daily budget → purchase.
- **Review/update frequency:** Quarterly.

### S7. Policy Application Submission
- **What to create:** Per-carrier submission checklists + chargeback-prevention guide (common rejection reasons).
- **Who creates it:** Top 5 reps by submission accuracy.
- **Who uses it:** All reps post-sale.
- **Key steps to capture:** Checklist per carrier with required fields, common errors, resubmission protocol.
- **Review/update frequency:** Every time a carrier updates forms.

### S8. Wylie's Existing AI Simulator
- **What to create:** Upgrade path to voice-to-voice with ingested rubric. This is more of a V2 build than a systemization per se, but categorizing it here because the rubric and practice loop need formalization.
- **Who creates it:** Dev + Wylie on rubric content.
- **Who uses it:** All reps, especially onboarding cohorts and bottom quintile.
- **Key steps to capture:** Pick persona → run session → auto-grade → log to rep profile → weakness surfaces in coaching report.
- **Review/update frequency:** Rubric reviewed quarterly.

---

## Removal Recommendations

### R1. Generic Zoom Training for Bottom Performers

- **What it is and why it exists:** Weekly group training call where managers deliver sales lessons to the bottom cohort. Exists because it's the only scalable way to deliver coaching under the current system.
- **Why it should be removed:**
  - **Customer Test:** Fail. Doesn't touch the customer.
  - **Revenue Test:** Weak. In theory improves close rates; in practice generic content doesn't match individual failure modes.
  - **Risk Test:** Fail. No legal/financial/reputational risk covered.
  - **Enablement Test:** Partial. Enables managers to "feel like they're helping" but doesn't actually move the needle.
  - **Decision Test:** Fail. Produces no data that drives real decisions.
  - **Fails 4 of 5.** Medium-high confidence.
- **Risk assessment:** **Low.** Replaced by AI personalized coaching report (A5) which is higher leverage per unit time.
- **Time/cost recovered:** 4-10 hrs/week manager time + 18-36 hrs/week rep attention org-wide.
- **Sunset approach:** **2-week trial.** Pause generic sessions for 2 weeks after AI coaching reports launch. If managers or reps miss it and it's driving measurable value, reinstate. Otherwise permanently stop.

### R2. Lead Spreadsheet Maintenance

- **What it is and why it exists:** Agents + managers maintain lead tracking in spreadsheets — who was called, what happened, who to call back. Exists because no CRM ever existed.
- **Why it should be removed:**
  - **Customer Test:** Fail.
  - **Revenue Test:** Weak. It's attempted revenue protection but poorly executed (leads forgotten, dialed blind).
  - **Risk Test:** Fail.
  - **Enablement Test:** Fail (actively harms enablement — reps lose context).
  - **Decision Test:** Fail (no aggregated signal).
  - **Fails all 5.** High confidence.
- **Risk assessment:** **Medium** — only because the spreadsheets are the current source of truth. Migration must happen cleanly.
- **Time/cost recovered:** 50+ hrs/week org-wide.
- **Sunset approach:** **Gradual phase-out** — CRM goes live → data migrated → spreadsheets made read-only for 2 weeks → archived → permanently removed.

---

## Owner's Protected Time

### Wylie's Genius Zone (KEEP)

These are the activities Wylie should spend 60-80% of his time on once optimization is complete:

1. **Cross-office manager sync** — holds the org together
2. **1:1s with top performers and ascending managers** — retention of the rare asset
3. **Agent interviews (edge cases, high-potential)** — his relational radar is the moat
4. **Strategic review of the dashboard** — make decisions, not pull numbers
5. **Recruiting leaders (not reps)** — next Mahmoud, not next agent
6. **The daily KPI whiteboard ritual** — cultural glue; keep in person
7. **Community-building, relationship maintenance** — the core skill

### Current vs Future Time Allocation

| Activity Category | Current % of Week | Target % of Week |
|---|---|---|
| Firefighting (ops stuff breaking) | ~25% | <5% |
| Manual numbers chasing | ~15% | <5% |
| Generic training delivery | ~15% | <5% |
| Recruiting + leader dev | ~20% | 40% |
| Top-performer 1:1s | ~10% | 25% |
| Strategic review (cockpit) | ~5% | 15% |
| Personal / family / faith | ~10% | 10%+ |

**Time gained:** 10-15 hours/week reclaimed for high-leverage work (growing his direct downline past Mahmoud's cap is literally Wylie's only path to uncapping his comp — and it happens in the top half of that table).

### Reallocation Recommendation

Every hour recovered should route to: **recruiting the NEXT leader** (not the next rep), **1:1 time with ascending managers**, and **strategic review of the dashboard**. This is how Wylie personally grows his direct downline past the Mahmoud structural cap.

---

## One-Page Dashboard Specification

### Hero Metric (Constraint Health)

**% of Agents Above $15K Issued Premium (Trailing 30 Days)**

- **Formula:** `count(agents where issued_premium_last_30d >= 15000) / count(active agents) × 100`
- **Data Source:** CRM `policies` table aggregated to `agents` (once CRM is live). Pre-CRM: manual import from carrier report.
- **Update frequency:** Daily at 6am ET (after overnight carrier reconciliation)
- **Green threshold:** ≥ 25% (target: double from today's 18%)
- **Amber threshold:** 18-24% (holding pattern)
- **Red threshold:** < 18% (regression)
- **Why this metric:** Directly measures whether the coaching-loop constraint is breaking. Every other metric is a leading/supporting indicator to this one.

### Full Metric Table

| # | Metric | Function | Type | Frequency | Green | Amber | Red | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | **% Agents Above $15K (Hero)** | Operations | Lagging | Daily | ≥25% | 18-24% | <18% | CRM + carrier feed |
| 2 | New Applicants This Week | Marketing | Leading | Weekly | ≥15 | 8-14 | <8 | Recruiting intake |
| 3 | Applicant → Live Dialer Conversion | Marketing | Lagging | Weekly | ≥60% | 40-59% | <40% | Onboarding checklist |
| 4 | Dials Per Rep Per Day | Sales | Leading | Daily | ≥80 | 50-79 | <50 | Dialer/CRM |
| 5 | Rep Close Rate (Contact → Sale) | Sales | Lagging | Weekly | ≥8% | 4-7% | <4% | CRM dispositions |
| 6 | Calls Recorded & Transcribed Coverage | Delivery | Leading | Daily | ≥95% | 80-94% | <80% | CRM + transcription |
| 7 | AI Coaching Reports Delivered | Delivery | Lagging | Weekly | ≥95% | 80-94% | <80% | Coaching pipeline |
| 8 | Wylie's Direct-Downline Monthly Issued Premium | Finance | Lagging | Monthly | +10% MoM | Flat | Declining | Carrier reports |
| 9 | Lead Cost Per Issued Deal | Finance | Lagging | Monthly | ≤$300 | $300-500 | >$500 | Goat Leads + CRM |
| 10 | Leaderboard Top 10 Composition (Retention/Mobility) | Operations | Leading | Weekly | 60-80% overlap | <60% or >90% | <40% or =100% | Leaderboard snapshots |
| 11 | Agents on Ascension Watch ($12K-14.9K) | Operations | Lagging | Weekly | ≥40 | 20-39 | <20 | CRM + carrier |

**Action protocols when red:**
- Hero red → Emergency TOC review. Which office regressed? Pull their top-vs-bottom diff reports. 1:1 with the manager within 48 hours.
- New Applicants red → Activate referral bonuses + community outreach.
- Applicant→Dialer Conversion red → Review onboarding stall points.
- Dials/Day red → Check activity drop (motivation, tool issue, burnout).
- Close Rate red → Auto-trigger AI call coach report for the rep.
- Calls Recorded red → Debug integration (Twilio webhook, Deepgram quota).
- Coaching Reports red → Debug pipeline.
- Wylie's Direct Downline red → Weekly 1:1s with managers, pull ascension candidate list.
- Lead Cost/Deal red → Trigger V3 lead-gen conversation + per-vendor P&L review.
- Top 10 Composition red → Too much turnover = top reps churning; too little = no mobility. Either is bad.
- Ascension Watch red → Assign 1:1 push coaching to the named reps. This is the cohort that flips the hero metric.

### Recommended Tool

**Built into the Next.js dashboard itself.** Don't introduce a separate BI tool (Notion/Google Sheets/Databox) — Wylie's team will have one place to go, not two. Dashboard lives at a subdomain of his org's domain. Free-tier-friendly: Vercel + Supabase + Clerk all free at this volume.

### Who Maintains It

- **Data pipeline health:** Rawgrowth dev (Dilan's build) — monitored via Vercel Observability.
- **Content / metric thresholds:** Reviewed by Wylie monthly for first 3 months, quarterly thereafter.
- **Accountability per metric:** Listed in "Accountable" column of full metric table (already in business-data.json).

### Review Cadence

- **Daily glance (30 seconds):** Hero metric + dials/day + calls recorded. Does anything need immediate attention?
- **Weekly deep review (15 minutes):** Full metric table + ascension watch cohort. Any reps need push coaching this week?
- **Monthly trend analysis (1 hour):** All metrics trending over 30/60/90 days. Is the constraint actually moving? Refine thresholds.

---

## Implementation Sequence

### Week 1 — Foundation
1. Pull raw data from Wylie (carrier report, lead spreadsheets, sales training doc, Cole Gordon materials)
2. Lock tech stack (Next.js + Supabase + Clerk + Vercel)
3. Schema design + auth scaffolding
4. Wireframe Leaderboard + Training Hub for Wylie approval
- **Dependencies:** Wylie sending the data + approving wireframes
- **Est. completion:** End of week 1

### Week 2 — Ship Leaderboard + Training Hub (V1.1 + V1.2)
5. Leaderboard shipped (live rank, filters, KPI column)
6. Training Hub shipped (upload, tag, watch tracking)
7. Launch on Monday group call with Wylie
- **Dependencies:** Week 1 complete
- **Est. completion:** End of week 2

### Week 3-4 — Systematize Existing Routines
8. Daily KPI digital module (4/4 ritual capture)
9. **REMOVE R2:** Begin spreadsheet-to-CRM migration plan
10. Dialer vendor decision (Close.com recommended)
11. Upload onboarding content to Training Hub
- **Dependencies:** Wylie's Cole Gordon content arriving
- **Est. completion:** End of week 4 (Checkpoint #1)

### Week 5-6 — Install the Signal (V1.3 + V1.4)
12. **A1:** Call recording + transcription pipeline live
13. **A2:** Dialer queue auto-population
14. CRM core tables + UI for reps
15. **S2:** Disposition logging enforced
16. **S3:** Lead history lookup
- **Dependencies:** Dialer vendor confirmed; Goat Leads export method confirmed
- **Est. completion:** End of week 6

### Week 7-8 — Onboarding + Polish (V1.5 + V1.6)
17. **S1:** Onboarding flow with graduation gates
18. Manager permissions + office roll-ups
19. **A6:** Leaderboard maintenance automated off CRM
20. **REMOVE R1:** Pause generic Zoom training (2-week trial starts)
- **Dependencies:** Reps adopting CRM
- **Est. completion:** End of week 8 (Checkpoint #2)

### Week 9-12 — AI Coaching Loop (V2.1)
21. Top-59 call corpus tagged + stored
22. **A4:** Top-vs-Bottom diff engine prototype
23. **A5:** Per-rep weekly coaching report (first batch)
24. **S5:** Recruiting pipeline
- **Dependencies:** ≥4 weeks of real call data
- **Est. completion:** End of week 12 (Checkpoint #3, 90-day review)

### Week 13-18 — V2 Extensions
25. **S8 / V2.2:** Voice-to-voice simulator
26. **A7:** Shout-out generator
27. **A9 / V2.6:** Owner Cockpit + weekly auto-brief
28. **A8:** Post-sale persistency outreach
- **Dependencies:** V1 + AI coaching proven

### Month 6+ — V3 Trigger
29. Review: has lead supply become the binding constraint? If yes, scope own lead-gen engine.

**Sequencing logic summary:**
- **Quick removals first** (R2 spreadsheet retirement is sequenced alongside CRM ship, so the removal IS the migration)
- **Constraint-zone automations next** (A1 call recording, A2 dialer queue, A6 leaderboard maintenance)
- **Systemizations that require new infra** (S1 onboarding, S2/S3 CRM discipline)
- **AI layer once data exists** (A4, A5 top-vs-bottom)
- **V2 extensions and V3 trigger** once the loop is proven

---

## Notes to the Dev

- **Every categorization in this document has a specific reason.** If you think a process should be categorized differently, good — push back. But reference the transcript or the constraint diagnosis when you do.
- **The dashboard is the product.** Every automation, every systemization, every removal serves the dashboard becoming Wylie's single source of truth.
- **Quantify everything post-launch.** Today's numbers are estimates. Two weeks after each module ships, pull real numbers and update this plan's thresholds.
- **Wylie's existing simulator is sacred.** Don't rebuild — augment. Ingest his rubric verbatim.
- **The 59 top performers are the curriculum.** Protect their time (don't demand extra training content from them), but capture their calls from day 1 of call recording going live.
