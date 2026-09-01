# Official multi-case research pilot

Date checked: 2026-09-01

This offline acceptance fixture uses bounded excerpts transcribed from three primary regulatory filings. It is intentionally narrow: each case makes one directly comparable revenue claim, then exercises Mira's Evidence verification, authorized review, case discovery, gated context, and recall audit lifecycle.

| Case | Primary source | Bounded fact used |
| --- | --- | --- |
| Apple FY2024 | [Apple 2024 Form 10-K](https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm) | FY2024 total net sales of $391.035 billion versus $383.285 billion in FY2023. |
| Microsoft FY2024 | [Microsoft 2024 Form 10-K](https://www.sec.gov/Archives/edgar/data/789019/000095017024087843/msft-20240630.htm) | FY2024 revenue of $245.122 billion versus $211.915 billion in FY2023. |
| NVIDIA FY2025 | [NVIDIA 2025 Form 10-K](https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm) | FY2025 revenue of $130.497 billion versus $60.922 billion in FY2024. |

The fixture stores the bounded text used for deterministic verification; it does not fetch or silently refresh remote content. A passing run proves that Mira enforces its recorded source boundary and lifecycle. It does not prove that every possible investment inference is true, nor does it authorize thesis mutation.

## Search architecture decision

Do not add hybrid or vector search based on this pilot alone. These cases validate Research Case selection and evidence-gated projection, but they do not produce a corpus of real recall misses. Keep the current SQLite FTS baseline until body-free recall receipts and user corrections identify repeated semantic misses that lexical retrieval cannot solve; then benchmark a hybrid candidate behind the existing Context Orchestrator instead of changing research truth semantics.

Run with:

```bash
npm run verify:multi-case-research
```
