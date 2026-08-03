const BLOCKED_TRANSCRIPT_ROLES = new Set(["developer", "system", "tool"]);
const CONTENT_TRANSCRIPT_ROLES = new Set(["user", "assistant", "message"]);

function normalizeHeading(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function transcriptRoleHeading(line: string): string | undefined {
  const match = line.match(/^(?<marks>#{2})\s+(?<title>.+)$/);
  if (!match?.groups?.title) return undefined;
  const normalized = normalizeHeading(match.groups.title);
  if (BLOCKED_TRANSCRIPT_ROLES.has(normalized) || CONTENT_TRANSCRIPT_ROLES.has(normalized)) {
    return normalized;
  }
  return undefined;
}

function isMetadataLine(line: string): boolean {
  const trimmed = line.trim();
  return /^Time:\s+\d{4}-\d{2}-\d{2}T/i.test(trimmed) ||
    /^>>>\s+TRANSCRIPT (?:START|END)$/i.test(trimmed);
}

function compactBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeThreadTextForDistill(rawText: string): string {
  const kept: string[] = [];
  let skippingBlockedRole = false;

  for (const line of rawText.split(/\r?\n/)) {
    const role = transcriptRoleHeading(line);
    if (role) {
      skippingBlockedRole = BLOCKED_TRANSCRIPT_ROLES.has(role);
      continue;
    }

    if (skippingBlockedRole) {
      continue;
    }

    if (isMetadataLine(line)) {
      continue;
    }

    kept.push(line);
  }

  return compactBlankLines(kept.join("\n"));
}
