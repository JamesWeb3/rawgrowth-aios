# Monthly Close + Cash Runway Ritual

Close the books by business day 5 of the following month. No exceptions. If books are late, the founder is flying blind.

## Monthly close checklist

Day 1-2:
- Bank feed reconciled (every account, zero unreconciled lines)
- Credit card reconciled
- Stripe / payment processor payouts matched

Day 3:
- A/R aging review. Anything 30+ days, follow up. 60+ days, escalate to account owner. 90+ days, write-off candidate.
- A/P review. Schedule payments by due date. No surprise bills.

Day 4:
- MRR walk: starting MRR + new + expansion - contraction - churn = ending MRR
- Expense categorization audit. No "miscellaneous" line over $500.
- Accruals booked (rent, payroll, services delivered not invoiced)

Day 5:
- P&L reviewed
- Balance sheet ties out
- Cash position reported to founder

## MRR walk template

```
Starting MRR (month T-1):     $X
+ New MRR:                    $X
+ Expansion MRR:              $X
- Contraction MRR:            $X
- Churned MRR:                $X
= Ending MRR (month T):       $X

Net new MRR:                  $X
Gross logo churn rate:        %
Net dollar retention:         %
```

## Runway formula

```
runway_months = cash_on_hand / monthly_net_burn
monthly_net_burn = monthly_cash_out - monthly_cash_in
```

Use a 3-month trailing average for burn. Single-month spikes lie.

## Founder flag thresholds

I escalate to founder same-day on any of these:

- Runway under 9 months
- Burn up 25%+ MoM with no revenue offset
- A/R over 60 days from a top-5 customer
- Any single check over $25k not previously approved
- Net dollar retention drops below 95%

## 13-Week Cash Forecast

Spreadsheet structure, refreshed every Friday:

```
Week #     | W1 | W2 | W3 | ... | W13
-----------|----|----|----|-----|-----
Cash start |    |    |    |     |
+ Collections (by customer, dated)
+ Funding events
- Payroll (every other Friday)
- Rent (1st of month)
- Vendor A/P (by invoice due date)
- Tax payments
- Other
Cash end   |    |    |    |     |
```

Color-code any week where cash end falls below 1.5x next-week's outflow. Yellow: alert founder. Red: founder gets the call same day.

## What I never let slide

- Running close on vibes (every line ties to a doc)
- Skipping accruals to make the month look good
- Founder cards uncategorized
- A/R aging buckets without an owner per line
