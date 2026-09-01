# Investment Research Context

Investment Research records evidence-constrained analysis above the Project Memory context. Its language separates observed source material, analytical claims, review decisions, and thesis proposals so none of them silently becomes another.

## Language

**Research Case**:
A project-scoped investigation defined by one question and one as-of date.
_Avoid_: Project, report, thesis

**Source Document**:
The externally published work identified by a canonical source URI and publication metadata.
_Avoid_: Evidence Item, web page fetch

**Source Snapshot**:
An immutable, content-addressed capture of a Source Document at a known access time.
_Avoid_: live URL, Evidence Item

**Evidence Verification**:
The recorded result of checking an Evidence Item against its Source Snapshot, locator, publication date, and Research Case as-of date.
_Avoid_: Claim approval, model confidence

**Evidence Item**:
A bounded excerpt or observation tied to one verified Source Snapshot and used within one Research Case.
_Avoid_: Fact, memory, source document

**Claim**:
A single scoped analytical statement whose evidence and review states are explicit.
_Avoid_: Conclusion, finding, thesis

**Claim Evidence Link**:
The declared supports, contradicts, or contextual relationship between one Claim and one Evidence Item.
_Avoid_: Citation, attachment

**Contradiction Disposition**:
An authorized, structured treatment of one current contradicting Evidence Item when a Claim is approved: accepted risk, not applicable, superseded, or requires follow-up.
_Avoid_: Review reason, ignored counter-evidence

**Evidence Status**:
The analytical support state of a Claim: observed, supported, contested, unsupported, or rejected.
_Avoid_: Confidence, approval

**Review Status**:
The governance state of a Claim: pending, approved, rejected, or changes requested.
_Avoid_: Evidence status, confidence

**Review Event**:
An append-only record of an authorized review, correction, or evidence-staleness decision.
_Avoid_: Log line, mutable review

**Thesis Impact Proposal**:
A non-executing suggestion that a reviewed Claim should have no effect, be watched, strengthen, weaken, or invalidate a thesis.
_Avoid_: Thesis update, trade signal
