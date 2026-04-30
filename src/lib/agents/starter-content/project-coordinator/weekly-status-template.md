# Weekly Status Template

Status reports are not theater. They exist so the team and the founder can make decisions on Monday morning without a meeting. Send Friday by 4 PM. Never miss a Friday.

## The 5 sections

Every report has these five sections, in this order. Skip none.

### 1. Shipped

What actually went live this week. Each line: short verb-led description, owner, link.

```
- Shipped agent hire v2 modal (Pedro, PR #412)
- Released Telegram webhook hardening (Maria, PR #418)
- Published Q2 onboarding playbook (Bruno, doc)
- Closed 3 P1 bugs in agent-runtime (Lucas, Linear ENG-880, ENG-882, ENG-885)
```

If a line doesn't have a link, it didn't ship. Verbal claims don't count.

### 2. In-flight

What's mid-build. Format: item, owner, due date, % done.

```
- Brand profile generation v3 - Maria - May 6 - 60%
- Pipeline forecast dashboard - Pedro - May 9 - 30%
- SLA matrix rollout to support - Bruno - May 7 - 80%
```

% done is owner's call. If it's been 60% for 3 weeks running, that's a flag.

### 3. Blocked

What's stuck and why. Owner + what's blocking + who can unblock.

```
- Agent runtime SDK v2 (Lucas) - blocked on API contract sign-off from Pedro
- Customer onboarding video (Bruno) - blocked on legal review of testimonial release
```

If it's blocked and there's no name attached to "who unblocks," fix the report before sending.

### 4. Decisions needed

Things that need a yes/no/budget approval from the founder this week.

```
- Approve $4k for retention research vendor (deciding this week, options A/B/C in attached doc)
- Hire decision on backend candidate L. Silva (offer expires Friday)
- Pricing change for enterprise tier from $X to $Y (rollout May 15 if approved)
```

One decision per line. Pre-state your recommendation. Saves a 30-minute meeting.

### 5. Asks

What you need from the team or the founder, that isn't a decision. Intros, time, eyes-on.

```
- @Pedro: 30 min Tue to walk through pipeline forecast data model
- @Maria: review the brand profile prompt before Monday
- Anyone: customer intros to fintech founders for retention interviews
```

## Rules

- Owners and dates are always populated. No "TBD."
- 250 words max. If it's longer, you're padding.
- Send same day, same time, every week.
- Archive every report in `/status-reports/YYYY-WW.md`. Future hires read these to learn the company.
- If a section is genuinely empty for a week (e.g., nothing blocked), write "None this week." Don't delete the section.

## What gets the report rejected

- Owners missing
- Due dates as "this week" instead of a date
- Decisions framed as "let's discuss" instead of yes/no
- Shipped items without links
- "Status: green" with no underlying data
