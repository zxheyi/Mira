/** Versioned local lexical policy; no embeddings, remote expansion or index changes. */
export const MEMORY_QUERY_POLICY_VERSION = "lexical-v2";

type Concept = {triggers: readonly string[]; alternatives: readonly string[]; requiresSoftwareContext?: boolean; questionObject?: boolean};
export type MemoryQueryPlan = {
  ftsQuery: string;
  substringTerms: string[];
  requiredConcepts: Array<{ftsQuery: string; substringTerms: string[]}>;
};

const segmenter = new Intl.Segmenter("zh", {granularity: "word"});
const han = /\p{Script=Han}/u;
const stopWords = new Set((
  "a an the i me my we our you your it its they their this that these those " +
  "am is are was were be been being do does did have has had can could should would may might " +
  "will shall must to of for from in on at by with as and or but if then than when where what which " +
  "who why how whether not no yes each every any all some such so also only into through about " +
  "的 了 呢 吗 是 在 把 被 从 到 和 与 或 及 我 我们 你 你们 它 这 那 这个 那个 " +
  "什么 哪个 哪些 哪条 多少 怎样 怎么 如何 是否 为何 能否 可以 应该 能够 需要 一个 每个 每条 上 下 中 时 后 前"
).split(/\s+/));

// A small developer vocabulary, with whole-word triggers. Deliberately do not
// equate integration with merge, preview with review, or main with a Git branch.
const concepts: readonly Concept[] = [
  {triggers: ["分支", "branch", "branches", "branching"], alternatives: ["分支", "branch", "branches", "main branch", "topic branch"]},
  {triggers: ["主干", "主分支", "trunk"], alternatives: ["主干", "主分支", "branch", "branches", "main branch", "trunk"], requiresSoftwareContext: true},
  {triggers: ["审核", "评审", "审查", "批准", "review", "reviews", "reviewed", "reviewing", "approval", "approve", "approved"],
    alternatives: ["审核", "评审", "审查", "批准", "review", "reviews", "reviewed", "approval", "approve", "approved"]},
  {triggers: ["合并", "合入", "merge", "merged", "merging"], alternatives: ["合并", "合入", "merge", "merged", "merging"]},
  {triggers: ["提交", "commit", "commits", "committed"], alternatives: ["提交", "commit", "commits", "committed"]},
  {triggers: ["端口", "port", "ports"], alternatives: ["端口", "port", "ports"], questionObject: true},
  {triggers: ["版本", "version", "versions"], alternatives: ["版本", "version", "versions"], questionObject: true},
  {triggers: ["数据库", "database", "databases"], alternatives: ["数据库", "database", "databases", "sqlite", "postgresql", "mysql"], questionObject: true}
];
const softwareContext = new Set(["代码", "仓库", "提交", "改动", "修复", "缺陷", "开发", "功能", "合并", "git", "code", "repository", "repo", "commit", "merge", "fix", "feature"]);

function words(text: string): string[] {
  return [...segmenter.segment(text.normalize("NFKC").toLowerCase())]
    .filter(part => part.isWordLike)
    .map(part => part.segment);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function isQuestion(query: string): boolean {
  return /[?？]/u.test(query)
    || /\b(?:what|which|where|when|why|how|can|could|should|does|would)\b/iu.test(query)
    || /什么|怎么|如何|是否|多少|哪条|哪个|怎样|为何|能否|可以|应该/u.test(query);
}

export function prepareMemoryQuery(query: string, mode: "phrase" | "orTerms", projectName: string): MemoryQueryPlan | undefined {
  // ICU can split technical terms such as 端口 into individual characters. The
  // declared glossary supplies only those complete Han terms, never arbitrary
  // character n-grams or substrings of Latin words (for example preview).
  const glossaryTerms = unique([...concepts.flatMap(concept => [...concept.triggers]), ...softwareContext])
    .filter(term => han.test(term) && query.includes(term));
  const tokens = unique([...words(query), ...glossaryTerms]);
  if (tokens.length === 0) return undefined;
  if (mode === "phrase") {
    return {ftsQuery: quote(query), substringTerms: han.test(query) ? [query] : [], requiredConcepts: []};
  }

  const question = isQuestion(query);
  let meaningful = tokens.filter(token => !stopWords.has(token)
    && (!question || !han.test(token) || token.length > 1 || tokens.length === 1));
  // Scope labels add no information when a specific topic is present, but an
  // explicit project-name-only query remains a real lexical query.
  const scopeWords = new Set([...words(projectName), ...(question ? ["project", "项目"] : [])]);
  const specific = meaningful.filter(token => !scopeWords.has(token));
  if (specific.length > 0) meaningful = specific;
  if (meaningful.length === 0) return undefined;
  meaningful = unique(meaningful).slice(0, 20);

  const present = new Set(meaningful);
  const software = meaningful.some(token => softwareContext.has(token));
  const activeConcepts = concepts.filter(concept => concept.triggers.some(trigger => present.has(trigger))
    && (!concept.requiresSoftwareContext || software));
  const alternatives = unique(activeConcepts.flatMap(concept => [...concept.alternatives]));
  // Retain contiguous CJK keywords as well as segmented words. SQLite's default
  // tokenizer does not split Han sentences, so substring matching is still needed.
  const compounds = (query.match(/\p{Script=Han}{2,}/gu) ?? [])
    .filter(compound => words(compound).some(token => present.has(token))
      && !stopWords.has(compound) && !(specific.length > 0 && scopeWords.has(compound)))
    .slice(0, 20);
  const terms = unique([...meaningful, ...compounds, ...alternatives]);
  return {
    ftsQuery: terms.map(quote).join(" OR "),
    substringTerms: terms.filter(term => han.test(term)),
    // Only the declared concrete question objects (port/version/database) are
    // mandatory. Branch/review/merge remain optional lexical alternatives, so a
    // workflow question need not repeat every action in one Memory. Explicit
    // keyword searches retain OR behavior across all meaningful terms.
    requiredConcepts: question ? activeConcepts.filter(concept => concept.questionObject).map(concept => ({
      ftsQuery: concept.alternatives.map(quote).join(" OR "),
      substringTerms: concept.alternatives.filter(term => han.test(term))
    })) : []
  };
}
