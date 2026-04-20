# Business X-Ray: Constraint Analysis Report

**Client:** Wylie Hawkins
**Business:** Wylie Hawkins Organization (life insurance distributor, 336 agents, 3 offices, ~$14M/yr issued premium)
**Date:** 2026-04-18
**Prepared by:** Dilan Patel (Rawgrowth)

---

## The Answer

The primary constraint in Wylie's business is **the absence of a coaching feedback loop at the dialing stage**. Every agent dials by hand on a personal phone with no CRM, no call recording, and no transcript — which means the 5x performance spread between the 59 top performers and the 277 struggling agents is invisible and therefore unfixable. The root cause is structural: the business scaled on relational magnetism (Wylie + Mahmoud Nasser's community) without ever building the operational instrumentation that coaching at scale requires. The constraint cascades into 82% of agents stuck below the $15K/mo contract-grid ascension threshold, chronic rep churn, and Wylie personally capped at ~$100K net take-home despite running a $14M organization — because his largest producer (Mahmoud, $11M of the $14M) is contracted at the same 145% ceiling as Wylie, yielding zero override on 80% of the org.

The single highest-leverage action is to **install a CRM + dialer + auto-recording + transcription + AI coaching diff engine + public leaderboard** as a unified web dashboard. This turns every call into data, every data point into coaching, and every coaching signal into behavioral lift. Expected impact: double the percentage of agents above $15K/mo (from 18% to 30-35%) within 6-9 months, recovering approximately **$250-375K/yr in owner compensation** currently left on the table. V1 ships in 8 weeks, V2 AI layer follows in weeks 10-18, and a V3 vertical-integration lead-gen play unlocks in month 6+ once conversion is fixed and Wylie can fund it.

---

## 1. North Star & Current Reality

### The Vision

Wylie wants to run a self-running org where his direct downline catches up to Mahmoud's team, override economics compound, and the business eventually vertically integrates to own its own lead supply. In his words: *"I want to get out of London, come over to America, find a good spot where there's good business, good community, good people."* More immediately, he wants *"a training hub [and] a competitive leaderboard... all in one area"* — the two most visible levers he's identified himself.

**Timeframe:** V1 dashboard in 8 weeks. V2+ (AI coach, simulator, recruiting) in 16-20 weeks. V3 (own lead-gen) in 6-9 months.

### The Business Today

Wylie's org is a life insurance distributor contracted with carriers at 140% commission. The org recruits agents who start at 85% and ascend the grid (90 → 95 → 100 → 145% ceiling) as they hit back-to-back $15K/mo issued-premium thresholds. Wylie earns the spread between his 140% contract and his downline's contracts — the "override." 336 agents across 3 physical offices produce ~$14M/yr in issued premium. Primary lead source: Goat Leads at $20/lead (final expense, IUL, trucker verticals). Primary channels: hand-dialing on purchased leads, daily whiteboard KPI rituals, and a Monday-Saturday themed training rotation.

### The Gap

- 18% of agents (59/336) clear the $15K threshold. 82% (277/336) don't.
- Wylie nets ~$100K/yr on a $14M org because his top producer Mahmoud is contracted at parity (145% = 145%).
- Leads cost $20 each, externally sourced, no ownership.
- No CRM, no call recording, no transcripts. Coaching is broadcast-only.
- Onboarding is, in Wylie's words, *"duct tape and super glue."*

---

## 2. The System (Value Stream Map)

The complete value stream is mapped in `business-data.json` under `valueStream.stages`. Draw.io diagrams were not generated in this pass — can be added on demand via the `Generate the system map for [client name]` skill command.

### Key Findings from the Value Stream

- **The biggest conversion drop is at the dialing stage.** Bottom quintile reps convert ~3-5% of contacts; top quintile ~15-20%+. Same leads, same training, 5x variance.
- **The biggest waste concentration is "unused talent" and "defects" at the dialing stage.** Top-59 patterns aren't captured; bottom-277 mistakes aren't diagnosed.
- **The biggest time-loss between stages is the signal gap between actual calls (stage 4) and sales training (stage 5).** Training is delivered but never informed by real call data.
- **The owner is the bottleneck** on reading numbers aloud, delivering training, making judgement calls each manager should be empowered to make.
- **The highest-leverage improvement opportunity** is installing the CRM + dialer + recording pipeline — nothing else in the business can break the constraint without this infrastructure first.

### Process Efficiency

Of ~25-35 hours per agent per week in "sales time," probably 70-80% is true value-add (talking to leads). The 20-30% of non-value time is exactly the coaching loop: call prep, lead lookup, disposition logging, post-call reflection. That loop is entirely uninstrumented, which is why the 277 struggle.

---

## 3. The Constraint

### What It Is

**The absence of a coaching feedback loop at the dialing stage** — no CRM, no call recording, no transcripts, no mechanism to see what top performers do differently from struggling performers.

### Why It Exists (Root Cause)

The business grew on Wylie's relational magnetism and Mahmoud's community reach. Every time ops capacity was needed, the founders found a relational workaround — hire a warm body, tap a community, throw more energy at the whiteboard. The workarounds worked well enough to mask the structural gap. Wylie himself diagnoses this: *"What we do really best, Dilan, is relationship. What we do terrible at is system and processes."*

The Mahmoud structural comp cap (both contracted at the 145% ceiling) further compressed Wylie's margin, making the ops infrastructure investment feel unaffordable. Classic catch-22: can't afford to fix the thing that's keeping comp low.

### The Cascade Effect

A single absent feedback loop produces nearly every symptom in the business:

- 82% of agents stuck below $15K/mo → because nobody can see what's failing
- High churn in struggling cohort → reps making $3,600/mo feel stuck, leave
- Recruiting quality can't improve → no source-to-outcome attribution
- Training feels generic → content not matched to individual failure modes
- Wylie capped at $100K net → direct downline doesn't ascend, override doesn't compound
- Mahmoud dependency deepens → only path around the cap is direct-downline growth
- Leads feel like the problem → underconversion makes every $20 lead feel expensive

### Evidence

- Wylie: *"I have 277 guys that are below 15,000 and I only have 59 guys above it."*
- Wylie: *"Every single one of the guys dials by hand."*
- Wylie: *"How can we get transcripts if they're just dialing? Like, we would need them to be mic'd up. They have mics and headsets, but we don't have a clear CRM."*
- Lead tracking is spreadsheet-based (Wylie shared the spreadsheet on screen).
- Wylie's own test on one group call — reading every agent's numbers aloud — produced immediate behavioral lift: *"by the end of the call, everyone was dialing with more intention than we've seen. Guys are making more sales than they ever have."* Proof visibility alone changes behavior. No tool exists to deliver it systemically.

---

## 4. First Principles Analysis

### Assumptions Being Made

| Assumption | Origin | Holds Up? |
|---|---|---|
| "Leads are the #1 constraint" | Inherited (5 years of lived pain) | **No.** Same leads → 5x performance variance. Leads are subjective pain, not objective constraint. |
| "Agents dialing by hand is normal" | Accidental (scaled past this without noticing) | **No.** Every mature sales org runs on integrated CRM + dialer. 1-week fix blocking years of leverage. |
| "Training must be live/generic" | Inherited | **No.** AI scales personalization to infinity at marginal cost. |
| "Each manager runs their own playbook" | Accidental | **No.** Worked at small scale, becomes waste at 336. |
| "Mahmoud's contract can't be renegotiated" | Deliberate | **Yes.** Accept as structural cap. Grow around it. |
| "Agents must buy their own leads" | Inherited | **No.** Vertical integration possible once conversion is fixed (V3). |

### What Would We Do Starting from Zero?

If we were building this business today:

1. **Every call is recorded from day one.** CRM + dialer + transcription before anyone dials a single number.
2. **The 59 top performers ARE the training curriculum.** Their calls get captured, tagged, and become the library.
3. **Personalized weekly coaching reports** for every rep, generated by AI, diffing their calls against top-performer patterns.
4. **Public leaderboard** as the default visibility layer. Every rep sees where they stand every day.
5. **Onboarding with graduation gates** — dialer access literally blocked until supervised-dial quality is proven.
6. **Centralized recruiting pipeline** with source-to-outcome attribution.
7. **Own lead supply** built in parallel once conversion is fixed.

### The Insight

**The product is the reps.** In Wylie's business, reps aren't employees delivering a product — they ARE the product. The carriers and lead vendors are suppliers; the agents are the manufactured output Wylie monetizes via override. This means every dashboard metric should be rep-level, every feedback loop rep-specific, and the whole business treated like a B2B SaaS product with 336 users whose outputs you monetize.

**Corollary insight:** The 59 top performers are already selling the same leads successfully. They ARE the training curriculum. We just haven't captured them yet.

---

## 5. The Fix (Action Plan)

### The #1 Priority

**Ship the Training Hub + public Leaderboard in 2 weeks, before any other dev work.**

Why: This is Wylie's explicit ask, it's the cheapest/fastest high-leverage win, and he's already proven the lever works (reading names aloud once → immediate lift). It can run on imported CSVs before the CRM exists.

**3 concrete steps:**
1. Pull raw data from Wylie (carrier issued-premium report + lead spreadsheets). Stand up Supabase schema (`agents`, `offices`, `policies`, `leaderboard_snapshots`, `training_content`, `training_progress`, `kpi_daily`).
2. Ship Next.js dashboard with two pages: Leaderboard (live rank + filters + KPI streak column) and Training Hub (upload, tag by Mon-Sat theme, watch tracking). Auth via Clerk with owner/manager/rep roles.
3. Launch on a Monday group call with Wylie announcing the board live to all 336 agents.

This unblocks everything else by delivering a visible win while the harder V1 build (CRM, dialer, call recording) is in progress.

### Constraint-Breaking Actions

| Priority | Action | Impact on Constraint | Effort | Timeframe |
|---|---|---|---|---|
| 1 | Ship Leaderboard + Training Hub | Installs visibility half of coaching loop | **Low** | Weeks 1-2 |
| 2 | Install CRM + Dialer + Call Recording | Installs signal half of coaching loop (THE fix) | **High** | Weeks 3-6 |
| 3 | Ship Onboarding with Graduation Gates | Prevents churn pre-ascension | **Med** | Weeks 6-8 |
| 4 | Ship AI Call Coach (Top-vs-Bottom Diff) | Converts data into coaching at scale | **High** | Weeks 10-14 |
| 5 | Ship Voice-to-Voice Simulator | Augments rep self-practice (Wylie's ask) | **High** | Weeks 12-16 |
| 6 | Ship Recruiting Pipeline | Source attribution → better cohorts | **Med** | Weeks 8-12 |
| 7 | Ship Owner Cockpit + Weekly Auto-Brief | Closes loop for Wylie (strategic view) | **Med** | Weeks 14-18 |
| 8 | V3 Own Lead-Gen Engine | Next constraint fix | **Very High** | Month 6+ |

Each action is specified in full detail (what, why, how, first-principles angle, timeframe, expected impact, success metric) in `action-plan.md`.

### What NOT to Do

- **Don't build own lead-gen in V1 or V2.** Until conversion is fixed, owned leads get burned at the same 3-5% close rate. The conversion fix has to come first.
- **Don't try to fix Mahmoud.** Renegotiation risks him leaving. Grow around the cap.
- **Don't over-engineer V1 CRM.** Lead, call, disposition, policy. That's it. No pipelines, no custom fields.
- **Don't redesign the training routine.** Mon-Sat themes work. The gap is the signal back, not the content.
- **Don't try to integrate Mahmoud's team into the dashboard.** He's walled off.
- **Don't build custom tools off-the-shelf solves.** Buy Close + Deepgram. Ship. Iterate.

---

## 6. 90-Day Roadmap

### Month 1: Ship the Visible Wins
- **Week 1:** Data pull, stack lock, schema + auth scaffolded, wireframes approved
- **Week 2:** Leaderboard + Training Hub shipped, launched on Monday group call
- **Week 3:** Daily KPI digital module, spreadsheet migration plan, dialer vendor decision
- **Week 4:** **Checkpoint #1** — adoption data review, confirm dialer vendor

### Month 2: Install the Signal
- **Week 5-6:** Dialer + CRM + call recording + dispositions enforced
- **Week 7-8:** **Checkpoint #2** — Onboarding flow with graduation gates, 95%+ call coverage verified

### Month 3: Install the Coaching Loop
- **Week 9-12:** AI coach built (needs 2-4 weeks of call data first), first coaching reports delivered. **Checkpoint #3 / 90-day review** — early signal on constraint metric.

**90-day success targets:**
- 95%+ call capture
- 100% of reps receiving weekly AI coach reports
- % agents above $15K: 18% → 22%+ (early signal; full lift shows in months 6-9)
- Onboarding graduation rate: ≥ 60%

---

## 7. AI & Automation Opportunities

| Task | Current Process | AI/Automation Solution | Time Saved/Week | Difficulty |
|---|---|---|---|---|
| Leaderboard maintenance | Wylie reads names manually | Live dashboard fed from CRM | 30 min + broadcast reach to 336 | Easy |
| Dial queue setup | Agents download CSVs manually | Goat Leads API → CRM auto-populate | 500+ hrs org-wide | Medium |
| Call recording & transcription | Doesn't exist | Dialer → cloud → Deepgram → CRM | Net new capability | Medium |
| Per-rep weekly coaching report | Impossible manually | LLM diff vs top-59 corpus | 700-1000 hrs manual equivalent | Hard |
| Weekly owner brief | Doesn't exist | Cron-triggered LLM summary | 4 hrs Wylie | Easy |
| Shout-outs | Wylie types in group chat | LLM drafts in Wylie's voice | 30 min/wk | Easy |
| Post-sale retention outreach | Not done | SMS/email on policy issue | Reduces cancel rate 2-3 pts | Medium |
| Recruiting intake & screening | Decentralized per manager | Centralized form + AI applicant summary | 5 hrs/wk across managers | Medium |
| Voice-to-voice sales practice | Wylie's text simulator | OpenAI Realtime + personas + auto-rubric | Adds capability | Hard |
| Cross-office metric roll-up | Manual pulls | Dashboard cockpit + NL query | 3 hrs/wk Wylie | Medium |
| Top-performer call library | Doesn't exist | Auto-flag + tag top reps' calls | Net new capability | Easy |
| Objection detection + clustering | Not captured | LLM scans transcripts, clusters patterns | Net new | Medium |

**Sequencing:** Infrastructure first (recording, queue, leaderboard) → AI layer once 2-4 weeks of data exists → V2 extensions (simulator, cockpit, recruiting).

---

## 8. Process Optimization Map

Every process in the business has been categorized. Full detail in `optimization-plan.md`.

### Categorization Summary

| Category | Count | Time Recovered/Week | Description |
|---|---|---|---|
| Automate | 8 | ~550-700 hrs org-wide | Rule-based tasks handled by CRM/AI |
| Delegate | 0 | — | No ops hire at V1 stage; revisit V2+ |
| Systemize | 8 | Variable (reduces rework/errors) | Needs SOPs, checklists, graduation gates |
| Keep | 7 | — | Owner's genius zone + high-leverage human work |
| Remove | 2 | 50+ hrs/wk org-wide | Zero-value tasks to eliminate |
| **Total** | **25** | **~600-750 hrs/wk recovered** | |

### Top Automation Opportunities

1. **Call Recording & Transcription** — Close.com or Twilio + Deepgram. Core missing infra.
2. **Dialer Queue Auto-Population** — Goat Leads → CRM → rep queue. 500+ hrs/week reclaimed.
3. **Top-vs-Bottom Call Diff Engine** — LLM weekly coaching reports. Impossible at human scale.

### Top Delegation Candidates

None at V1 — no ops hire exists. V2+ candidates (post-hire): Recruiting Intake, Lead Purchase SOP, Agent Compensation Tracking.

### What to Remove

- **Generic Zoom Training for Bottom Performers** — replaced by AI personalized coaching reports. 2-week trial shutoff after AI reports launch.
- **Lead Spreadsheet Maintenance** — replaced entirely by CRM. Gradual phase-out during migration.

### Owner's Genius Zone (Keep)

Wylie should spend 60-80% of his time on: cross-office manager sync, 1:1s with top performers and ascending managers, agent interviews (edge cases/high-potential), strategic review of the dashboard, recruiting LEADERS (not reps), the daily KPI whiteboard ritual, and relationship/community-building. Current week is ~25% firefighting + 15% manual numbers chasing + 15% generic training; target is <5% firefighting + 40% recruiting+leader dev + 25% top-performer 1:1s.

**See `optimization-plan.md` for the complete process-by-process plan with implementation details.**

---

## 9. One-Page Dashboard Specification

### The Hero Metric (Constraint Health)

**% of Agents Above $15K Issued Premium (Trailing 30 Days)**

- Formula: `count(agents with issued_premium_last_30d ≥ 15000) / count(active agents) × 100`
- Today: ~18%. Target: ≥25% in 6-9 months. Goal: double to ~35%.
- Green ≥25%. Amber 18-24%. Red <18%.
- Data: CRM + carrier feed (daily refresh post-launch).

### Full Dashboard Metrics

| # | Metric | Function | Type | Frequency | Green | Amber | Red | Source |
|---|---|---|---|---|---|---|---|---|
| 1 | **% Agents Above $15K** (Hero) | Operations | Lagging | Daily | ≥25% | 18-24% | <18% | CRM + carrier |
| 2 | New Applicants This Week | Marketing | Leading | Weekly | ≥15 | 8-14 | <8 | Recruiting intake |
| 3 | Applicant → Dialer Conversion | Marketing | Lagging | Weekly | ≥60% | 40-59% | <40% | Onboarding checklist |
| 4 | Dials Per Rep Per Day | Sales | Leading | Daily | ≥80 | 50-79 | <50 | Dialer/CRM |
| 5 | Rep Close Rate | Sales | Lagging | Weekly | ≥8% | 4-7% | <4% | CRM dispositions |
| 6 | Calls Recorded Coverage | Delivery | Leading | Daily | ≥95% | 80-94% | <80% | CRM + Deepgram |
| 7 | Coaching Reports Delivered | Delivery | Lagging | Weekly | ≥95% | 80-94% | <80% | Coach pipeline |
| 8 | Wylie's Direct-Downline MIP | Finance | Lagging | Monthly | +10% MoM | Flat | Declining | Carrier |
| 9 | Lead Cost Per Issued Deal | Finance | Lagging | Monthly | ≤$300 | $300-500 | >$500 | Goat Leads + CRM |
| 10 | Top 10 Composition (Mobility) | Operations | Leading | Weekly | 60-80% overlap | <60% or >90% | <40% or =100% | Leaderboard |
| 11 | Agents on Ascension Watch ($12K-14.9K) | Operations | Lagging | Weekly | ≥40 | 20-39 | <20 | CRM + carrier |

### Implementation

- **Built into the Next.js dashboard itself** — don't split into a separate BI tool.
- Vercel + Supabase + Clerk. Free tier covers V1 volume.
- **Maintained by:** Rawgrowth dev (pipeline health via Vercel Observability); Wylie reviews thresholds monthly for first 3 months, then quarterly.
- **Review cadence:** Daily glance (30 sec) / weekly deep review (15 min) / monthly trend analysis (1 hr).

---

## 10. Future State

### With the Constraint Removed

Every call is captured the moment it ends. Transcripts flow into the CRM. The AI coach runs Sunday night and by Monday 6 AM every rep has a 5-bullet coaching report waiting — strengths, top 3 weak moments, specific objection patterns they failed, recommended Training Hub content, and quote comparisons against a top performer who handled the same situation.

The leaderboard is live on the office TVs and on every rep's phone. The $15K cliff cohort is surfaced weekly for manager push-coaching. New hires don't touch the dialer until their manager signs off on week-4 graduation — churn in the first 30 days plummets.

Wylie stops reading names aloud. He stops chasing numbers. He opens the cockpit in the morning with coffee, scans the hero metric, reviews the cliff cohort, and spends his day on what he's actually world-class at: recruiting leaders and running the culture. The dashboard handles the rest.

Within 6-9 months, the % of agents above $15K has doubled. Wylie's direct downline is ascending at a measurable rate. Override compounds. Net take-home rises from $100K toward $250-300K. The Mahmoud structural cap becomes less painful because less of the business runs through it.

### The Next Constraint

Once conversion is fixed, **lead supply becomes binding.** The org will profitably absorb more leads than Goat Leads can reliably provide. Symptoms: rising lead cost-per-deal, top reps running out of volume, Goat Leads supply fragmenting. This is the V3 trigger. Build the own lead-gen engine once conversion is proven and Wylie's comp has lifted enough to fund the build. Don't start it before month 6. Plan for it, don't pre-empt it.

---

## Next Steps

1. **Today:** Wylie sends Dilan the carrier issued-premium report, the lead spreadsheets, his sales training doc, and Cole Gordon materials. Dilan texts Chris re: Texas visit dates.
2. **This week:** Dilan locks tech stack, stands up Supabase schema, wireframes Leaderboard + Training Hub for Wylie approval.
3. **Next week:** Launch Leaderboard + Training Hub on a Monday group call. First real leaderboard event. First data captured.

---

*This report was generated using the Business X-Ray diagnostic framework, combining Theory of Constraints, First Principles thinking, and Value Stream Analysis to identify and break the primary bottleneck in Wylie's business system. Discovery was conducted via recorded audit call (Fathom link in `session-notes.md`). Supporting deliverables: `constraint-report.md` (full diagnosis), `action-plan.md` (detailed recommendations), `optimization-plan.md` (process-by-process plan + dashboard spec), `business-data.json` (structured data), `session-notes.md` (quotes + action items + context).*
