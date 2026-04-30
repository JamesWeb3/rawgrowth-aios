# API Contract Checklist

Before any API change merges, the PR must clear this checklist. No exceptions, including hotfixes (especially hotfixes).

## Idempotency

- [ ] Mutating endpoints accept `Idempotency-Key` header
- [ ] Server stores key + response for 24h minimum
- [ ] Same key + same body returns cached response
- [ ] Same key + different body returns 422 with explicit error
- [ ] Tests cover replay scenario

## Error envelope

Every error response uses the same shape:

```json
{
  "error": {
    "code": "string_snake_case",
    "message": "Human-readable, no PII",
    "request_id": "uuid",
    "details": { "field": "reason" }
  }
}
```

- [ ] No raw stack traces in response
- [ ] No internal table names or column names
- [ ] HTTP status matches the error code semantically
- [ ] `request_id` ties to logs

## Auth scope

- [ ] Endpoint declares required scope explicitly
- [ ] Scope check runs before any DB query
- [ ] Multi-tenancy: every query filtered by `org_id` from token, not from body
- [ ] No "admin" backdoor flags
- [ ] Tests cover unauthorized + cross-tenant access

## Rate limit

- [ ] Endpoint declared in rate-limit config
- [ ] Limit set per scope (per-user, per-org, per-IP)
- [ ] Returns 429 with `Retry-After` header
- [ ] Webhooks: signed, retried with exponential backoff, idempotent on receiver

## Observability hooks

- [ ] Structured log on entry: endpoint, user_id, org_id, request_id, latency_target
- [ ] Structured log on exit: status, latency_ms, error_code if any
- [ ] Counter metric per endpoint x status code
- [ ] Histogram metric for latency p50/p95/p99
- [ ] Trace span with at least one attribute (org_id)
- [ ] No PII in logs (email hashed, no raw tokens)

## Schema migration safety

For DB changes:

- [ ] Migration is backwards-compatible with current code (expand, then contract)
- [ ] Adding NOT NULL columns: default value or two-step migration
- [ ] Renaming columns: add new, dual-write, backfill, switch reads, drop old
- [ ] Dropping columns: only after 2 full deploy cycles confirming no reads
- [ ] Index changes use `CREATE INDEX CONCURRENTLY`
- [ ] Migration tested on staging with prod-sized data
- [ ] Rollback plan documented in PR

## Versioning

- [ ] Breaking changes go to a new version path (`/v2/...`)
- [ ] Old version sunset date communicated, minimum 90 days
- [ ] Deprecation header (`Sunset`, `Deprecation`) set on old version

## PR template addition

Every API PR must answer in the description:

```
What endpoint changed:
Breaking change? Y/N
Idempotent? Y/N
Auth scope:
Rate limit:
Migration risk:
Rollback steps:
```

If a section is N/A, write N/A. Don't leave blanks.

## What I never approve

- "We'll add tests next PR"
- New endpoint with no metric
- Migration without rollback
- Mutating endpoint with no idempotency story
