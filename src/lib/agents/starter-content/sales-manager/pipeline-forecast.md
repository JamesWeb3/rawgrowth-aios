# Pipeline Forecast: How We Call the Number

Forecasting is not vibes. It's bottom-up by stage probability. If a rep can't show me the math, the deal isn't in the forecast.

## Bottom-up method

Every deal has a stage. Every stage has a fixed probability. We don't let reps freelance the percentage based on "feel."

Default stage probabilities:

- Discovery booked: 5%
- Discovery completed: 15%
- Demo completed: 30%
- Proposal sent: 50%
- Verbal commit: 80%
- Contract sent: 90%
- Closed won: 100%

Weighted pipeline formula:

```
weighted_pipeline = sum(deal_value * stage_probability)
```

Run it in SQL every Sunday night so Monday's number is the same number every rep is staring at.

```sql
SELECT
  rep_id,
  SUM(amount * stage_probability) AS weighted_pipeline,
  COUNT(*) AS open_deals
FROM deals
WHERE stage NOT IN ('closed_won', 'closed_lost')
  AND close_date BETWEEN date_trunc('quarter', current_date)
                     AND date_trunc('quarter', current_date) + interval '3 months'
GROUP BY rep_id;
```

## Commit / Best / Upside

Three numbers per rep, every week:

- **Commit**: deals you stake your job on. 90%+ probability, contract or verbal in hand.
- **Best case**: commit + deals at 50%+ that are tracking on plan.
- **Upside**: best case + new deals that could close in-quarter if everything breaks right.

Rep's commit number must clear quota. If it doesn't, escalation.

## Weekly stage-movement review

Every Monday, 30 min with each rep. Walk the deal board. For each deal that didn't move stage in 7 days, ask:

- What's the next concrete step?
- Who owns it?
- When does it happen?

No answer in three of the three? Deal goes on the at-risk list.

## Kill date

Every deal gets a kill date when it enters the pipeline. Default: 90 days from creation. If the deal hasn't progressed by the kill date, it's removed from forecast and reclassified as nurture. No mercy. Stale pipeline kills morale and pollutes the number.

## What I never accept

- "Big deal coming, trust me"
- Forecasts without next-step in writing
- Champion-less deals at 50%+
- Single-threaded enterprise deals at 80%+
