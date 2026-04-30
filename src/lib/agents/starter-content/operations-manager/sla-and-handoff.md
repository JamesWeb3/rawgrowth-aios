# SLA Matrix and Handoff Protocol

Operations runs on two artifacts: the SLA matrix and the handoff checklist. If either is broken, the client feels it within a week.

## SLA Matrix

| Ticket Type | Response | Resolution | Channel |
|-------------|----------|------------|---------|
| P0 outage | 15 min | 4 hr | Phone + Slack |
| P1 critical bug | 1 hr | 24 hr | Slack |
| P2 standard bug | 4 hr business | 5 business days | Linear |
| Feature request | 1 business day | Triaged in 7 days | Linear |
| Billing question | 4 hr business | 1 business day | Email |
| Onboarding step blocked | 30 min business | 4 hr business | Slack |

Business hours: Mon-Fri 9am-7pm BRT. Outside hours, P0 only.

## Handoff Protocol: Sales to Delivery

The day a deal closes, sales has 24 hours to deliver:

- Signed contract + SOW
- Stakeholder map (decision maker, champion, blocker, end users)
- Recorded discovery + demo
- Promised scope (what was sold, in writing)
- Anti-promised scope (what was explicitly NOT sold)
- Kickoff date

Delivery lead reviews within 48 hours. Anything missing, ticket back to AE. Kickoff doesn't start until handoff is green.

## Handoff Protocol: Delivery to Support

At end of project, delivery hands to support:

- Runbook (top 10 known issues + fixes)
- Architecture diagram
- Access credentials in vault
- Client-side primary contact
- Post-launch metrics + baseline

## Escalation Tree

```
P0 outage triggers:
  0-15 min:  on-call engineer
  15-30 min: engineering manager
  30-60 min: head of operations
  60+ min:   founder

After hours:
  P0: on-call phone (rotation)
  Anything else: next business day
```

On-call rotation is one week, Mon 9am to next Mon 9am. Comp: $200 flat plus 1.5x for any incident worked outside hours.

## One-page Client Charter

Every account gets a one-pager kept up to date:

- Who they are (industry, ARR, employees)
- What they bought (scope + price)
- Who their team is (names, roles, channels)
- What they care about (top 3 outcomes)
- Renewal date and current health (green/yellow/red)
- Last 3 wins, last 3 issues

CSM owns the doc. Updated end of every month. If a doc is more than 30 days stale, the account is treated as at-risk by default.

## What kills SLAs

- Tickets without category at intake (force the picker)
- "Quick favor" channel that bypasses queue
- Founders responding directly in DMs (now you have no record)
