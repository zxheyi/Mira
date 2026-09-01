import type { ResearchCaseSnapshot } from "./researchTypes.js";

function line(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function optional(value: string | undefined): string {
  return value ? line(value) : "—";
}

export function renderResearchCaseMarkdown(snapshot: ResearchCaseSnapshot): string {
  const { researchCase, snapshots, evidence, verifications, claims, events } = snapshot;
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const output: string[] = [
    "# Research Case: " + line(researchCase.title),
    "",
    "- Case ID: `" + researchCase.id + "`",
    "- Question: " + line(researchCase.question),
    "- As of: " + researchCase.asOfDate,
    "- Status: `" + researchCase.status + "`",
    "",
    "## Source Snapshot Ledger",
    ""
  ];

  for (const item of snapshots) {
    output.push(
      "### " + item.id,
      "",
      "- State: `" + item.state + "`",
      "- Source: [" + line(item.sourceTitle) + "](" + item.canonicalUri + ")",
      "- Published: " + optional(item.publishedAt),
      "- Accessed: " + item.accessedAt,
      "- Media type: `" + item.mediaType + "`",
      "- SHA-256: `" + item.contentHash + "`",
      ""
    );
  }

  output.push("## Evidence Ledger", "");

  for (const item of evidence) {
    output.push(
      "### " + item.id,
      "",
      "- State: `" + item.state + "`",
      "- Source type: `" + item.sourceType + "`",
      "- Source: [" + line(item.sourceTitle) + "](" + item.sourceUri + ")",
      "- Locator: " + line(item.locator),
      "- Published: " + optional(item.publishedAt),
      "- Accessed: " + item.accessedAt,
      "- Valid through: " + optional(item.validThrough),
      "- Snapshot: " + (item.snapshotId ? "`" + item.snapshotId + "`" : "—"),
      "- Content hash: `" + item.contentHash + "`",
      "",
      "> " + line(item.excerpt),
      ""
    );
  }

  output.push("## Evidence Verification", "");
  for (const item of verifications) {
    output.push(
      "### " + item.id,
      "",
      "- Evidence: `" + item.evidenceId + "`",
      "- Snapshot: `" + item.snapshotId + "`",
      "- Status: `" + item.status + "`" + (item.current ? " (current)" : " (historical)"),
      "- Verified at: " + optional(item.verifiedAt),
      "- Checks: `" + JSON.stringify(item.checks) + "`",
      "- Check codes: `" + JSON.stringify(item.receipt.checkCodes) + "`",
      "- Stored SHA-256: `" + item.receipt.storedContentHash + "`",
      "- Actual SHA-256: `" + item.receipt.actualContentHash + "`",
      ""
    );
  }

  output.push("## Claim Matrix", "");
  for (const claim of claims) {
    output.push(
      "### " + claim.id,
      "",
      line(claim.statement),
      "",
      "- Lifecycle: `" + claim.status + "`",
      "- Evidence status: `" + claim.evidenceStatus + "`",
      "- Review status: `" + claim.reviewStatus + "`",
      "- Confidence: " + claim.confidence,
      "- Thesis impact proposal: `" + claim.thesisImpact + "`",
      "- Invalidation conditions: " + line(claim.invalidationConditions),
      "- Supersedes: " + (claim.supersedesClaimId ? "`" + claim.supersedesClaimId + "`" : "—"),
      "",
      "Evidence links:",
      ""
    );
    for (const link of claim.links) {
      const source = evidenceById.get(link.evidenceId);
      output.push(
        "- `" + link.relation + "` → `" + link.evidenceId + "`"
        + (source ? " (" + line(source.sourceTitle) + ", " + line(source.locator) + ")" : "")
        + ": " + line(link.rationale)
      );
    }
    output.push("");
  }

  output.push("## Review Events", "");
  for (const event of events) {
    output.push(
      "- " + event.createdAt + " `" + event.eventType + "` (`" + event.id + "`): "
      + JSON.stringify(event.receipt)
    );
  }
  output.push(
    "",
    "## Boundary",
    "",
    "This export is a derived audit view. Source Snapshot content is intentionally omitted. Mira does not mutate thesis state, portfolio state, or trading decisions.",
    ""
  );
  return output.join("\n");
}
