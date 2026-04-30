# Standup, Review, On-call

Engineering runs on three rituals: daily standup, weekly architecture review, and on-call rotation. The post-incident template ties it together.

## Daily standup (12 min hard cap)

Three questions, in order, per person:

1. What did I ship yesterday? (linked PR or doc)
2. What am I shipping today?
3. What's blocking me?

Rules:

- 12 minutes. Timer visible. Cut speaker at 1 min if they ramble.
- Blockers go to a parking lot. Not solved in standup.
- No status theater. No "working on the thing." Show the PR.
- Walk the board, not the people. Start at "in review," then "in progress," then "blocked."
- If standup runs long 3 days in a row, format is broken. Fix it.

If everyone is in flow and there's nothing to coordinate, kill standup that day. The point is signal, not ceremony.

## Weekly architecture review (60 min)

Every Thursday. One slot for one proposal. Author submits a 1-2 page RFC by Wednesday EOD.

RFC template:

```
# RFC: <title>
Author: <name>
Status: draft | accepted | rejected
Date: YYYY-MM-DD

## Context
What problem are we solving? Why now?

## Proposal
What we're building. Diagram if useful.

## Alternatives considered
At least two, with why we rejected them.

## Risks
What breaks if this goes wrong?

## Migration plan
How we get from here to there. Reversibility?

## Metrics
What does success look like in numbers?
```

Review checklist:

- Reversible or one-way door? (one-way doors get extra scrutiny)
- Failure modes documented
- On-call impact considered
- Cost estimate within order of magnitude
- Owner assigned

## On-call rotation rules

- 1 week shifts, Mon 9am to Mon 9am
- Primary + secondary, secondary only paged if primary unreachable in 10 min
- Comp: $250 flat, plus 1.5x for any work outside business hours
- You can swap shifts up to 48 hours before, no questions
- If you're sick, secondary takes over, no guilt
- New hires shadow for 2 rotations before going primary

## Post-Incident Review template

Within 5 business days of a P0/P1:

```
# Incident Review: <short title>
Date / duration / severity / detection method

## Impact
Users affected, revenue lost, SLA breaches.

## Timeline
HH:MM events, source-of-truth from logs.

## Root cause
Technical cause + organizational cause.

## What went well
At least 3 items. Don't skip this.

## What went wrong
At least 3 items. Blameless. Systems, not people.

## Action items
Owner + due date per item. Tracked in Linear.
```

Blameless. We attack the system, not the engineer who pushed the button.
