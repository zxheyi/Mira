---
status: accepted
date: 2026-09-01
---

# Verify Evidence against immutable Source Snapshots

## Decision

An Evidence Item must reference an immutable Source Snapshot before a Claim can be approved. Verification checks snapshot integrity, locator/excerpt presence, publication time against the Research Case as-of date, and freshness metadata. A live URL or caller-provided excerpt alone is not verified Evidence.

## Context

Research Case v0 preserved source URI, locator, excerpt, and hash, but the production gate could not prove that the excerpt came from the identified source or that the source existed by the as-of date. This distinction is material in investment research because a structurally valid citation can still be fabricated, revised later, or temporally invalid.

## Alternatives

- Trust caller-provided excerpts: simple, but provides only evidence-shaped data.
- Fetch every source during Claim review: couples review to network availability and mutable remote content.
- Store content-addressed snapshots and verify locally: makes review deterministic and keeps retrieval separate from approval.

## Consequences

- Source acquisition and Evidence verification are separate operations.
- Snapshot content is local project data and is subject to size and sensitive-information limits.
- A failed or stale verification reopens affected Claims.
- Mira still does not decide semantic investment truth automatically; authorized review remains required.
