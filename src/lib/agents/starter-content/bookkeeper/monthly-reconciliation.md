# Monthly Reconciliation

Reconciliation is not optional, not "when I have time." Books reconcile by business day 5 of the following month. If the books are off, every downstream decision is off.

## Step 1: Bank feed reconcile

Per bank account:

- Pull the bank statement PDF
- Match every line in the accounting system to a line on the statement
- Beginning + ending balances per system tie to the statement
- Zero unreconciled lines. Zero. Not "one or two small ones."

If a line doesn't match: wrong period, duplicate, or money moved without a ticket. Investigate same day.

## Step 2: Credit card reconcile

Same flow as bank. Gotchas:

- Statement period rarely aligns with calendar month. Cut at month-end, book unbilled portion as accrual.
- FX charges: book at transaction-date rate, not statement-date.
- Disputes / chargebacks: separate sub-account until resolved.

## Step 3: Payroll match

For each pay run in the period:

- Gross wages tie to the payroll provider report
- Employer taxes (INSS, FGTS) booked
- Benefits (health, food card) booked
- Net pay matches bank withdrawals to the cent
- 13th salary and vacation accruals booked monthly, not at year-end

If headcount changed mid-month, prorate. Don't round.

## Step 4: Expense categorization

Every transaction must have:

- Vendor (real name, not "Amazon" generically - which entity?)
- Category (matching the chart of accounts)
- Memo (1-line: what was this for)
- Receipt attached (for anything over R$50)

Audit the "uncategorized" bucket. Empty it before close. Anything older than 7 days uncategorized triggers a flag to the team member who incurred the expense.

## Step 5: Accruals

Book what's earned/incurred but not yet invoiced/billed:

- Services delivered, not yet invoiced (revenue accrual)
- Consultants / contractors who worked, not yet paid
- Rent, utilities for the period regardless of payment date
- Bonus pool accrual (1/12 of estimated annual)

Reverse next month when actual hits.

## Step 6: Fixed asset schedule

Maintain a register:

```
Asset | Purchase date | Cost | Useful life | Monthly depreciation | NBV
Laptop X | 2025-03-15 | R$8,000 | 36 months | R$222.22 | R$X
```

- Depreciation booked monthly, not at year-end
- Disposals removed in period of disposal with gain/loss to P&L
- Inventory check yearly (where is each laptop right now?)

## Audit-trail flags

I escalate any of these same day:

- Unreconciled bank lines older than 5 business days
- Expenses without receipts over R$500
- Round-number payments without invoice
- Owner's personal cards mixed into business books
- Manual journal entries without memo + supporting doc
- Vendor master with no CNPJ on file
- Two vendors at the same address (duplicate / fraud signal)

## What I never let pass

- "Just plug it" entries to make books balance
- Round-number accruals with no calculation backup
- Payroll booked from memory instead of the provider report
- Closing the month with cash off by any amount
