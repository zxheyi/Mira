import type { ResearchCaseSnapshot } from "./researchTypes.js";

function line(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

function optional(value: string | undefined): string {
  return value ? line(value) : "—";
}

export function renderResearchCaseMarkdown(snapshot: ResearchCaseSnapshot): string {
  const { researchCase, evidence, claims, events } = snapshot;
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const output: string[] = [
    "# Research Case: " + line(researchCase.title),
    "",
    "- Case ID: `" + researchCase.id + "`",
    "- Question: " + line(researchCase.question),
    "- As of: " + researchCase.asOfDate,
    "- Status: `" + researchCase.status + "`",
    "",
    "## Evidence Ledger",
    ""
  ];

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
      "- Content hash: `" + item.contentHash + "`",
      "",
      "> " + line(item.excerpt),
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
    "This export is a derived audit view. Mira does not mutate thesis state, portfolio state, or trading decisions.",
    ""
  );
  return output.join("\n");
}
