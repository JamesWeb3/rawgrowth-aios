# Session Notes — Wylie Hawkins X-Ray

**Source:** Fathom recording of the AI audit call (Apr 15, 2026, 45 min)
**URL:** https://fathom.video/share/xy3bWxyHMvrHxsxH537xY2KKEELSAY6Q
**Participants:** Wylie Hawkins (client), Dilan Patel (Rawgrowth), Ed (Wylie's office manager — joined late)
**X-Ray author:** Dilan, 2026-04-18

---

## Context

This X-Ray was generated from a transcript rather than a live discovery session. Dilan conducted the audit call in discovery mode; this document structures what came out of it using the business-xray skill format.

Wylie is a Rawgrowth client. This engagement is about building the AI/ops infrastructure for his 336-agent life insurance distribution org.

Chris (Rawgrowth CEO) set up the intro. Dilan owns the build. There are parallel calls with Jackson (another manager) and a follow-up with Chris pending. Dilan plans an in-person Texas visit; dates TBD with Chris.

---

## Stakeholder Map

| Person | Role | Leverage |
|---|---|---|
| **Wylie Hawkins** | Owner, 140% contract, 26 direct downlines | Primary decision-maker. Funds the build. |
| **Mahmoud Nasser** | Produces $11M of org's $14M. 145% contract (= Wylie). | **Walled off** — do not design around. No override to Wylie. |
| **Ed** | One of 3 office managers. Has run leads before. | Internal technical ally. Joined the call late, added the 4-problem framing. |
| **Jackson** | Another manager | Dilan has a call with him later same day. |
| **Brody** | Mentioned as 1:1 target | Peripheral to the build. |
| **Chris West** | Rawgrowth CEO | Books Dilan's travel; sets scope commercial terms. |

---

## Key Numbers (captured from call)

- **336 agents total** across 3 physical offices
- **277 below $15K/mo** issued premium
- **59 above $15K/mo**
- **$14M/yr** total issued premium org-wide
- **$11M** of that is Mahmoud's team; **$3M** is Wylie's direct
- **$20/lead** from Goat Leads (primary vendor)
- **$1,200** avg annual premium per policy
- **85%** agent starting commission, ascends to **145%** ceiling
- **75% upfront** + 25% trailing months 10-12
- **30% policy cancellation rate** baked in (industry standard)
- **Wylie personal:** $250K gross, $150K business expenses, $100K net take-home
- **Agent avg take-home:** ~$3,600/mo for the struggling cohort
- **Goat Leads org size:** Wylie estimates $2-5M/mo revenue → huge TAM validates V3 lead-gen play

---

## Direct Quotes (preserved for deliverables)

### On the core problem
> "I have 277 guys that are below 15,000 and I only have 59 guys above it. So the guys at the top make really good, but we need to help get everyone else into a flow."

### On lack of systems
> "It's like, you know, the fact that I'm in this position blows my mind. I think it's because I'm naturally just so good with people and attracting people. But it's like duct tape and super glue."

> "What we do really best, Dilan, is relationship. What we do terrible at is system and processes."

### On hand-dialing (the smoking gun)
> "Every single one of the guys dials by hand."
> Dilan: "Okay, and what would the optimized way of dialing be?"
> Wylie: "Well, the thing is, is how can we get transcripts if they're just dialing? Like, we would need them to be mic'd up. They have mics and headsets, but we don't have a clear CRM."

### On what Wylie wants in V1
> "Here's the big three things. Can we have a training hub? Could we have a competitive leaderboard? Because then when they see it, they'll want to compete. And honestly, if we just can get those two things down and just get them all in one area."

### On leads (his stated #1 constraint)
> "Leads is our biggest constraint, it's been our biggest constraint for five years."
> "If we could make our own leads, that would be the best thing ever."
> "I know that's the solution. I just, I've never had someone that I feel like could do it."

### On leaderboard proof-of-concept
> "The other week I dropped on the call, I said, hey, here's your numbers. I read off every single name and it took me 30 minutes or whatever it took me. But by the end of the call, everyone was dialing with more intention than we've seen. Guys are making more sales than they ever have. They're buying more leads. They're actually showing up, working, and taking it serious."

### On the Mahmoud structural cap
> Dilan: "Mahmoud gets all of the commission for his 11 million or for his 8 million."
> Wylie: "Zero. The highest comp you can earn is 145. And so your guys will... 145%. And then when Mahmoud reaches a million dollars a month, he also earns a 145, and that makes us equal... I don't have any difference between him and me. So I'm not making override."

### On Wylie's own AI simulator (existing asset)
> "I have built a simulator to where they could, number one, they can practice by themselves with the AI, where I have a certain rubric to grade their conversation when they do the simulator."

### Ed's four-problem framing (canonical scope)
> "So number one, the recruiting process, onboarding, leads, the sales training. Those are the four core points."

### On generosity / financial discipline (side-context)
> "I have a really big, generous heart and it's hurt me in the past, but I don't want to stop giving to people."
> Dilan: "Bro, don't change yourself. Just change who you spend time with."

### On Dilan's role (client trust signal)
> Wylie: "I know that's the solution. I just, I've never had someone that I feel like could do it."
> Wylie: "I don't want to get rid of you. We just started."

---

## Existing Sales Training Routine (KEEP — don't redesign)

**Daily KPI whiteboard ritual** — 4 questions, public call-out:
1. Did you get a sale?
2. Did you go to the gym?
3. Did you post a reel?
4. Did you read your Bible?

4/4 = public shout-out before anything else.

**Weekly theme rotation:**
- Monday: Intro (tone, pace, intro objections)
- Tuesday: Discovery
- Wednesday: Numbers
- Thursday: Application (policy submission)
- Friday: Hot Topic
- Saturday: (Wylie said "I wouldn't even change that" but didn't specify — clarify)

This ROUTINE is strong. The gap is the feedback signal back into it.

---

## Action Items (from Fathom)

- [ ] **Wylie → Dilan:** Send sales training doc + Cole Gordon materials (Wylie used to work with Cole Gordon)
- [ ] **Wylie → Dilan:** Send lead spreadsheets (this is the V1 import source)
- [ ] **Managers → Dilan:** Send recruiting process details
- [ ] **Wylie → Dilan:** Send invite to Apr 16 9am CST agency call (record if Dilan misses)
- [ ] **Dilan → Chris:** Text re: Texas visit dates + logistics
- [ ] **Dilan → Jackson:** 1:1 call later same day
- [ ] **Wylie:** Schedule 1:1 with Brody (Wylie's note, not Dilan's task)

---

## X-Ray Process Stage Completion

- [x] Discovery (via recorded audit call, Apr 15)
- [x] Data structuring (business-data.json, Apr 18)
- [x] Diagnosis (constraint-report.md)
- [x] Recommendations (action-plan.md)
- [x] Optimization (optimization-plan.md)
- [x] Final Report (final-report.md)
- [ ] Draw.io diagrams — NOT generated in this pass (can be added via "Generate the system map" command if needed)

---

## Notes for the AI Developer (Rawgrowth dev handoff)

The four deliverables (constraint-report, action-plan, optimization-plan, final-report) are written for different audiences:

- **constraint-report.md** — Read this first. Understand what's broken and why.
- **action-plan.md** — Read this second. This is your sequenced build roadmap.
- **optimization-plan.md** — Read this third. This is the operational detail: every process categorized, full dashboard spec, implementation sequence.
- **final-report.md** — This is the assembled client-facing deliverable. Useful if you need to re-explain scope to Wylie.

**V1 scope lock:** Training Hub + Leaderboard + Minimum-Viable CRM + Call Capture + Onboarding Flow. Everything else is V2+.

**Do not design around Mahmoud's team.** Every build decision should assume Mahmoud is a separate business that pays no dividend to the system.
