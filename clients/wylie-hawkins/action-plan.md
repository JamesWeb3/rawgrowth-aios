# Action Plan — Wylie Hawkins

**Date:** 2026-04-18
**Prepared by:** Dilan Patel (Rawgrowth)
**For:** Wylie Hawkins (client) + Rawgrowth AI developer (build audience)
**Linked:** `constraint-report.md`, `optimization-plan.md`, `session-notes.md`

---

## The Answer

The binding constraint is the **absence of a coaching feedback loop** at the dialing stage. The highest-leverage action is to **install a CRM + dialer + call recording + transcription + live leaderboard** as a unified web dashboard, which will make agent execution visible, coachable, and competitive. This unlocks the $15K/mo ascension threshold for the 277 stuck agents, moves the business from **18% → 30%+ of agents above $15K** within 6-9 months, and recovers an estimated **$250-375K/yr in owner compensation** Wylie is currently leaving on the table.

---

## The #1 Action (This Week)

**Ship the public Leaderboard + the first version of the Training Hub, before any other dev work.**

**What:** A simple live web app that shows every agent's name + monthly issued premium + contract tier, plus a central library of existing training content tagged by day-of-week theme. No CRM yet. No call recording yet. Just the two things Wylie explicitly named as his #1 request.

**Why:** This is the one piece we can ship in <2 weeks that Wylie has already proven works — he tested it himself by reading names aloud on a group call and saw immediate urgency lift. It's the cheapest, fastest, most visible win on the board. It also builds Dilan's credibility with Wylie for the harder CRM + call-recording build that follows.

**The 3 steps:**
1. **Pull the raw data now.** Get Wylie's carrier issued-premium report + the lead spreadsheets (he already agreed to send both). Stand up a Supabase with `agents`, `offices`, `policies`, and `leaderboard_snapshots` tables. Manual CSV import is fine for week 1.
2. **Ship a minimum Next.js dashboard** with two pages: (a) Leaderboard (live rankings, filterable by office/manager/tier, 4/4 KPI column) and (b) Training Hub (video + doc upload, tag by Mon/Tue/Wed/Thu/Fri theme). Deploy to Vercel. Auth via Clerk with 3 roles: owner, manager, rep.
3. **Launch it on a Monday group call** with Wylie announcing the board live to all 336 agents. The launch itself is the first leaderboard event.

**Why this first:** Everything else (CRM, dialer, call recording, AI coaching) takes 6-8 weeks minimum. The Leaderboard + Hub take 10-14 days. Shipping them first produces behavioral lift while the harder build is in progress, generates the first real data for the dashboard, and earns the political capital with Wylie to invest the next 8 weeks of dev time.

---

## Constraint-Breaking Actions (Ordered by Leverage)

### 1. Ship Leaderboard + Training Hub (V1.1 + V1.2)

- **What:** Live public leaderboard + central training content library in one dashboard.
- **Why:** Wylie's proven lever. Zero CRM dependency. Immediate behavioral lift on 336 agents. Directly attacks the coaching-loop constraint by installing the **visibility** half of the loop before the **signal** half.
- **How:**
  1. Supabase schema: `agents`, `offices`, `policies`, `training_content`, `training_progress`, `leaderboard_snapshots`, `kpi_daily`.
  2. Next.js + shadcn + Clerk auth (owner / manager / rep roles).
  3. CSV import utility for carrier issued-premium report (weekly refresh for now).
  4. Training Hub: upload, tag by weekly theme (Mon Intro / Tue Discovery / Wed Numbers / Thu Application / Fri Hot Topic), per-rep watch tracking.
  5. Leaderboard: monthly issued premium rank, filters by office/manager/tier, top 10 highlight, most-improved-this-week callout, 4/4 KPI streak column.
  6. Deploy to Vercel. Launch on a Monday group call.
- **First Principles angle:** Don't wait for the full CRM. Leaderboard can run on imported CSVs until the CRM catches up. The lever doesn't need the full system — it just needs to be public.
- **Timeframe:** Start week 1. Live by end of week 2. Full polish by week 4.
- **Expected impact:** Immediate urgency spike across the org (Wylie's own test is the evidence). Expect 5-15% lift in dials/day per agent within 4 weeks of launch.
- **Success metric:** Avg dials/day/agent rising + top 10 leaderboard positions cycling (indicates mobility, not stagnation).

### 2. Install CRM + Dialer + Call Recording (V1.3 + V1.4)

- **What:** Replace spreadsheets with a CRM. Replace hand-dialing with a browser-based dialer. Auto-record and transcribe every call.
- **Why:** This IS the constraint fix. Without it, there is no coaching loop possible. This is the core V1 engineering investment.
- **How:**
  1. Pick dialer: **Close.com** for fastest V1 (native CRM + dialer + API) OR **Twilio custom** for cheapest long-term + most control. Recommend Close.com for V1, migrate to Twilio in V2 once economics demand it.
  2. Wire dialer → Supabase (call metadata → `calls` table, recording URL → cloud storage).
  3. Transcription: Deepgram (best price/quality on bulk call audio) → `calls.transcript` field.
  4. Import Goat Leads CSV → dialer queue per rep.
  5. Dispositions enforced after every call (dropdown in dialer UI, not freeform).
  6. Lead history shown on every dial attempt (anti-redial-blind).
- **First Principles angle:** Don't build a custom dialer in V1 — buy Close.com, integrate, earn the right to build it yourself later. Don't overbuild the CRM — lead, calls, dispositions, policies is the V1 schema. No pipelines, no tags, no custom fields.
- **Timeframe:** Start week 3. Live by end of week 6. First week of real call data by end of week 7.
- **Expected impact:** 100% of calls captured and transcribed. Sets the stage for V2 AI coaching. Interim side effect: reps stop redialing blind (expect 5-10% conversion lift just from lead history visibility).
- **Success metric:** Calls-recorded-as-% of calls-dialed ≥ 95% within 2 weeks of launch.

### 3. Ship Onboarding Flow with Graduation Gates (V1.5)

- **What:** Structured 4-week onboarding track tied to Training Hub completion. Dialer access gated behind graduation sign-off.
- **Why:** Directly addresses the "bootcamp is duct tape" pain. New hires who hit the phones before ready churn early — waste of recruiting spend and a drag on leaderboard averages. Graduation gate turns a vague process into a binary event.
- **How:**
  1. Onboarding checklist module: week 1 intake/compliance/shadow → week 2 bootcamp modules → week 3 supervised dials → week 4 graduation.
  2. Manager-side sign-off required for each gate.
  3. Dialer access literally blocked until week 4 sign-off.
  4. First 3 live dials reviewed by manager before agent is "unsupervised."
- **First Principles angle:** The question isn't "what training should we include?" — it's "what must be true before this person is allowed to cost us leads?" Work backward from that gate.
- **Timeframe:** Week 6-8.
- **Expected impact:** 30-day agent churn drops 20-40%. Recruiting ROI rises because fewer washouts per cohort.
- **Success metric:** Cohort graduation rate ≥ 60% within 30 days; first-month issued-premium average for new cohorts ≥ $5K (baseline TBD).

### 4. Ship AI Call Coach — Top-vs-Bottom Diff (V2.1)

- **What:** Weekly AI-generated coaching report per rep. LLM diffs the rep's last N calls against the top-59 corpus. Flags the exact moment, the exact objection, and what a top rep said instead.
- **Why:** This converts the raw call data from V1.4 into the actual coaching loop. Impossible at human scale (336 reps × 5-10 calls/week = 1,680-3,360 hours of manual review). Perfect LLM job.
- **How:**
  1. Nightly job: pull last 7 days of calls per rep, score against rubric (ingest Wylie's existing rubric from his text simulator).
  2. LLM generates 5-bullet coaching report per rep: strengths, top 3 weak moments, specific objection patterns, recommended Training Hub content, vs-top-performer quote comparison.
  3. Delivered via dashboard + email Monday AM.
  4. Manager sees aggregate view of their office.
- **First Principles angle:** Don't invent training content — extract it from calls we already have. The 59 top performers ARE the curriculum.
- **Timeframe:** Weeks 10-14 (needs 2-4 weeks of real call data first).
- **Expected impact:** Conversion rate lift in bottom quintile from 3-5% → 6-10% within 90 days. Eventual doubling of the ascension rate.
- **Success metric:** 95%+ of active reps receiving their weekly report; bottom-quintile close rate trending up week-over-week.

### 5. Ship Voice-to-Voice Sales Simulator (V2.2)

- **What:** Real-time voice role-play with LLM + TTS acting as a prospect. Pause-on-miss when rep breaks a rubric item. Personas: widow, price-shopper, trucker, young family.
- **Why:** Wylie specifically requested this on the call ("voice-to-voice with you"). Upgrade of his existing text simulator. Meets reps where they are (voice is the actual selling medium).
- **How:**
  1. OpenAI Realtime API or ElevenLabs + Claude for persona voices.
  2. Ingest Wylie's existing grading rubric.
  3. Auto-score each session, append to rep's training record in dashboard.
  4. Replay library so reps can review their own simulated calls.
- **First Principles angle:** The simulator is a practice field. The real game is in the CRM calls. Wire both so the simulator data and the real-call data live in the same rep profile.
- **Timeframe:** Weeks 12-16.
- **Expected impact:** Supplementary practice reps for struggling agents. Measurable by correlation between simulator usage and live-call improvement.
- **Success metric:** Weekly simulator sessions per bottom-quintile rep ≥ 3.

### 6. Ship Recruiting Pipeline (V2.3)

- **What:** Centralized applicant intake → stages (applied, screened, offer, onboarding, live dialer) → source attribution tied to long-term outcomes.
- **Why:** Ed's problem #1. "No unison" across managers today. Fixing this gives the org the ability to double down on channels that actually produce $15K+ reps.
- **How:**
  1. Typeform/Tally intake form feeding Supabase `recruits` table.
  2. Kanban-style manager view with stage transitions.
  3. Source field required. Attribution tracked from intake → ascension (6-9 month window).
  4. Manager credits: each manager sees their own pipeline + gets credit for referrals.
- **First Principles angle:** Recruiting without outcome attribution is gambling. Every applicant should have a line of sight from source → hire → first deal → $15K cliff.
- **Timeframe:** Weeks 8-12.
- **Expected impact:** Within 6 months of operation, the org knows which 2-3 recruiting sources produce $15K+ reps reliably. Recruiting budget concentrates there.
- **Success metric:** 100% of new hires have source attribution; per-source ascension rate visible after 6 months.

### 7. Ship Owner Cockpit + Weekly Auto-Brief (V2.6)

- **What:** Single pane for Wylie showing revenue, contract-tier distribution, ascension candidates, cross-office comparison. Natural-language chat ("show every rep who slipped below $15K last 60 days"). Weekly auto-brief emailed Monday AM.
- **Why:** Wylie runs the business by gut today. Cockpit turns the dashboard into a decision-making tool and frees his time.
- **How:**
  1. Roll-ups of all the above metrics into one page.
  2. AI SDK + Vercel AI Gateway for natural-language query layer.
  3. Cron-triggered weekly brief (Monday 6 AM) via Vercel Cron + Workflow DevKit.
- **First Principles angle:** The dashboard is for the agents. The cockpit is for Wylie. Two audiences, two views, same data.
- **Timeframe:** Weeks 14-18.
- **Expected impact:** Wylie reclaims 8-12 hrs/week currently spent firefighting or manually pulling numbers.
- **Success metric:** Wylie opens the cockpit daily; responds to red flags within 48 hours.

### 8. (V3) Own Lead-Gen Engine

- **What:** Paid ads (Meta/TikTok/YouTube) → own landing pages → own lead forms → best leads route to own reps at cost, surplus leads resold to other insurance orgs.
- **Why:** Once conversion is fixed (V1+V2), the org's $20/lead cost at Goat Leads becomes the binding constraint. Building own supply erodes the biggest cost line and creates a second P&L.
- **How:** Separate engagement — do not start until V1 + most of V2 is live and Wylie's comp has lifted enough to fund the build.
- **First Principles angle:** Wylie already lives inside the Goat Leads market. Every market insight he has is a starting edge. Don't copy Goat Leads — undercut them with better targeting on the same source channels.
- **Timeframe:** Month 6-9 onward.
- **Expected impact:** Lead cost per deal: $300 → $80-120 (illustrative). Second revenue stream from lead resale.
- **Success metric:** Own-sourced leads become >50% of org volume within 12 months of V3 launch.

---

## System Redesign

### New Value Stream (What Wylie's Org Looks Like with the Constraint Broken)

1. **Recruit** — Centralized intake form, source attribution, manager pipeline view. Applicant → screened → offer in ≤2 weeks.
2. **Onboard** — 4-week sequenced track in Training Hub. Manager sign-off gates dialer access. Week 4 graduation event.
3. **Acquire Leads** — Goat Leads (V1-V2) → dialer queue auto-populated → rep sees prioritized leads with full history. V3: own lead supply.
4. **Dial** — Browser dialer with recording + transcription. Every call captured. Dispositions enforced.
5. **Train & Coach** — Weekly AI coach report per rep. Voice-to-voice simulator for self-practice. Training Hub with searchable top-performer calls as content.
6. **Leaderboard** — Live, public. Every rep sees where they stand. Cliff-push cohort ($12-14.9K) explicitly surfaced.
7. **Submit & Persist** — Automated SMS/email post-sale reduces the 30% cancel rate. Per-rep persistency tracked.
8. **Ascend** — % of agents above $15K/mo is the hero metric. Cockpit flags cliff-close reps weekly for manager action.

### Role Changes

- **Wylie stops:** Reading names manually on calls. Delivering generic training content. Chasing managers for their numbers. Reinventing onboarding each cohort.
- **Wylie starts:** Monitoring the cockpit daily. Weekly strategic review with managers over leaderboard data. Deciding when to invest in V3 lead-gen.
- **Wylie continues:** Recruiting top-tier managers. Holding the relational culture. 1:1 time with ascending leaders.
- **Managers stop:** Running independent training. Improvising onboarding. Managing leads in spreadsheets.
- **Managers start:** Precision coaching using AI coach reports. Referring applicants into the centralized pipeline. Signing off onboarding graduation gates.
- **Reps start:** Dialing inside the CRM. Practicing in the voice simulator. Reviewing their own weekly coaching report.

### Tools & Systems

- **Dashboard:** Next.js + shadcn + Supabase + Clerk. Deployed on Vercel.
- **Dialer:** Close.com (V1) → Twilio custom (V2+).
- **Transcription:** Deepgram.
- **AI:** AI SDK + Vercel AI Gateway (provider-agnostic: Claude for coaching reports, OpenAI Realtime for voice sim).
- **Cron / workflows:** Vercel Cron + Workflow DevKit for nightly AI scoring, weekly briefs, auto-send of coaching reports.
- **Analytics:** Vercel Observability + Speed Insights (for dashboard itself).

### The Next Constraint

Once conversion is fixed, **lead supply becomes binding.** The org will be able to profitably convert more leads than Goat Leads can reliably provide. Symptoms: rising lead cost-per-deal, lead availability falling, top reps running out of dials. This is the V3 trigger. Plan for it, don't start it prematurely.

---

## 90-Day Roadmap

### Month 1 (Weeks 1-4): Ship the Visible Wins

- **Week 1:** Data pull from Wylie (carrier report + lead spreadsheets). Supabase schema locked. Auth scaffolded. Wireframes approved.
- **Week 2:** Training Hub + Leaderboard shipped. Launched on Monday group call. First real leaderboard snapshot.
- **Week 3:** Onboarding checklist module + daily KPI entry (4/4 ritual digitized). CSV refresh automated for policies. First week of dashboard adoption data.
- **Week 4:** **Checkpoint #1.** Leaderboard + Hub live across 3 offices. Wylie reviews adoption data with Dilan. Decision gate: approve dialer selection (Close vs. Twilio).

### Month 2 (Weeks 5-8): Install the Signal

- **Week 5-6:** Dialer + CRM + call recording wired. Goat Leads queue auto-populated. Dispositions enforced.
- **Week 7-8:** **Checkpoint #2.** Call coverage ≥ 95%. Transcription pipeline verified. Onboarding flow shipped with graduation gates. Roles + permissions hardened.

### Month 3 (Weeks 9-12): Install the Coaching Loop

- **Week 9-10:** Start the AI Call Coach build (needs 2 weeks of call data first). Corpus of top-59 calls tagged for training.
- **Week 11-12:** First AI coaching reports delivered. Manager coaching view shipped. **Month 3 checkpoint:** % agents above $15K trending up; first ascension candidates surfaced from the $12-14.9K cliff cohort.

**90-day success targets:**
- 95%+ call capture
- 100% of reps receiving weekly AI coach reports
- % agents above $15K: 18% → 22%+ (early signal — full lift shows in months 6-9)
- Onboarding graduation rate: ≥ 60%

**Decision point at day 90:** Continue V2 build (simulator + recruiting pipeline + cockpit) vs. pivot based on data. If constraint isn't moving, re-diagnose.

---

## AI & Automation Opportunities

| Task | Current Process | AI/Automation Solution | Time Saved/Week | Difficulty |
|---|---|---|---|---|
| Leaderboard maintenance | Wylie reads names manually, ad hoc | Live dashboard fed from CRM + carrier report | ~30 min Wylie + broadcast reach to 336 | Easy |
| Dial queue setup per rep | Agents download CSVs manually | Goat Leads API → auto-populate CRM dialer queue | ~1.5 hrs/agent/wk × 336 = 500+ hrs org-wide | Medium |
| Call recording & transcription | Doesn't exist | Dialer webhook → cloud storage → Deepgram → `calls.transcript` | Net new capability | Medium |
| Per-rep weekly coaching report | Impossible at scale | LLM diff engine against top-59 corpus; delivered Monday AM | Net new capability — would be 700-1000 hrs manual | Hard |
| Weekly owner brief | Doesn't exist | Cron-triggered LLM summary of dashboard into email | ~4 hrs/wk for Wylie | Easy |
| Manual shout-outs | Wylie types in group chats | LLM drafts in Wylie's voice from leaderboard; Wylie approves | ~30 min/wk | Easy |
| Post-sale retention outreach | Not done by most reps | SMS/email automation triggered on policy submission | Reduce 30% cancel rate by 2-3 points → material override lift | Medium |
| Recruiting intake & screening | Decentralized, each manager | Centralized form + AI summary of each applicant | ~5 hrs/wk across managers | Medium |
| Voice-to-voice sales practice | Wylie's text simulator | OpenAI Realtime + TTS personas + auto-rubric | Adds capability; zero rep-facing cost | Hard |
| Cross-office metric roll-up | Manual pulls | Dashboard cockpit + natural-language query | ~3 hrs/wk Wylie | Medium |
| Top-performer call library | Doesn't exist | Auto-flag + tag top reps' calls as training corpus | Net new capability | Easy (post-recording) |
| Objection detection + clustering | Not captured | LLM scans transcripts, clusters objections, surfaces recurring patterns | Net new; informs training content | Medium |

**Sequencing guidance:**
- **Implement first:** Leaderboard automation, dial queue automation, call recording (these are the infrastructure layer).
- **Implement second:** AI coaching reports, objection detection (once 2-4 weeks of data exists).
- **Implement third:** Voice-to-voice simulator, owner cockpit, recruiting pipeline (once coaching loop is proven).

---

## What NOT to Do

### 1. **DO NOT build the own-lead-gen engine (V3) in V1 or V2.**

- **The temptation:** Wylie's stated #1 constraint. Immediate relief on the $20/lead cost. Seems like a natural Dilan skill ("I can run your ads").
- **Why it feels productive:** Lead cost is visible every month. Every dollar saved feels concrete.
- **Why it will not work:** Until conversion is fixed, owned leads just get burned at the same 3-5% close rate by the 277 struggling agents. You'll save $12/lead on acquisition and still lose on yield. The conversion fix has to come first.
- **When it becomes relevant:** Month 6+, after the coaching loop has lifted the ascension rate and the org can demonstrably convert leads profitably.

### 2. **DO NOT try to "fix Mahmoud."**

- **The temptation:** Renegotiate his contract, claw back override, restructure the relationship.
- **Why it feels productive:** He's 80% of the org at zero override.
- **Why it will not work:** Mahmoud has leverage (community, production track record). Renegotiation risks him leaving. The ONLY way around the Mahmoud cap is growing Wylie's direct downline faster, which is exactly what the V1/V2 build enables.
- **When it becomes relevant:** Never, probably. Grow around it.

### 3. **DO NOT over-engineer the V1 CRM.**

- **The temptation:** Pipelines, custom fields, advanced segmentation, marketing automation, multi-product support.
- **Why it feels productive:** More features = more obviously powerful.
- **Why it will not work:** Every feature you add is a feature the 336 reps have to learn. V1 scope must be: lead, call, disposition, policy. That's it.
- **When it becomes relevant:** V2, once adoption is proven and specific pain points demand features.

### 4. **DO NOT redesign the training routine.**

- **The temptation:** Replace Mon-Sat themes with some new framework. Bring in new sales methodology.
- **Why it feels productive:** More expertise = better training.
- **Why it will not work:** The routine is one of the few things that works. The content library is Cole-Gordon-informed and Wylie-approved. The gap is the signal back into the routine, not the routine itself. Changing it disrupts momentum.
- **When it becomes relevant:** If AI coaching reports consistently show the routine isn't addressing the top 3 objection patterns, revisit content. Not before.

### 5. **DO NOT try to integrate Mahmoud's team into the dashboard.**

- **The temptation:** Inclusivity. Completeness. Org-wide visibility.
- **Why it feels productive:** The leaderboard looks more impressive with 336 agents on it than 150.
- **Why it will not work:** Mahmoud is functionally a separate business. Demanding he adopt new infra risks the relationship. He gets nothing from the leaderboard that he doesn't already have.
- **When it becomes relevant:** If Mahmoud volunteers. Not before.

### 6. **DO NOT build custom tools that off-the-shelf solves.**

- **The temptation:** "We could build our own dialer" or "we could build our own transcription."
- **Why it feels productive:** Control, customization, no vendor dependency.
- **Why it will not work:** Dialers are mature. Transcription is commoditized. Building either in V1 burns 4-6 weeks for zero differentiation. Buy Close + Deepgram, ship, iterate.
- **When it becomes relevant:** V2+ if vendor costs become material AND a specific requirement can't be met off-the-shelf.

---

## Summary — The Spine of the Plan

1. **Leaderboard + Training Hub** in 2 weeks (cheapest, proven lever).
2. **CRM + Dialer + Call Recording** in weeks 3-6 (constraint fix infrastructure).
3. **Onboarding Flow** in weeks 6-8 (graduation gates).
4. **AI Call Coach** in weeks 10-14 (turns data into coaching).
5. **Voice Simulator** in weeks 12-16 (Wylie's specific ask, upgraded).
6. **Recruiting Pipeline** in weeks 8-12 (parallel track).
7. **Owner Cockpit** in weeks 14-18 (closes the loop for Wylie).
8. **V3 lead-gen** after month 6, once conversion is proven.

Everything that isn't on this list doesn't belong in this engagement.
