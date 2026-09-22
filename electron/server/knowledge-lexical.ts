export interface KnowledgeLexicalDocument {
  rel: string;
  content: string;
  chunkIndex: number;
  chunkCount: number;
}

export type KnowledgeLexicalChannel = "bm25" | "title" | "exact";

export interface KnowledgeLexicalResult extends KnowledgeLexicalDocument {
  score: number;
  channel: KnowledgeLexicalChannel;
}

interface IndexedKnowledgeLexicalDocument extends KnowledgeLexicalDocument {
  titleTokens: string[];
  bodyTokens: string[];
  titleTermFrequency: Map<string, number>;
  bodyTermFrequency: Map<string, number>;
  normalizedTitle: string;
  normalizedBody: string;
  identifiers: Set<string>;
}

export interface KnowledgeLexicalIndex {
  documents: IndexedKnowledgeLexicalDocument[];
  documentFrequency: Map<string, number>;
  averageBodyLength: number;
}

const QUERY_TOKEN_LIMIT = 96;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const SYNONYM_GROUPS = [
  ["搜索", "检索", "查询", "search", "retrieve", "retrieval"],
  ["错误", "报错", "异常", "故障", "error", "exception", "failure"],
  ["配置", "设置", "设定", "config", "configuration", "setting"],
  ["登录", "登陆", "认证", "鉴权", "login", "signin", "auth", "authentication"],
  ["图片", "图像", "照片", "image", "picture", "photo"],
  ["知识库", "文档库", "资料库", "knowledgebase", "knowledge-base"],
  ["流式", "流输出", "stream", "streaming"],
  ["响应", "返回", "回复", "response", "reply"],
  ["模型", "model"],
  ["上下文", "context"],
  ["工作区", "workspace"],
  ["项目", "工程", "project"],
] as const;

const SYNONYM_LOOKUP = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYM_LOOKUP.set(term, group.filter((candidate) => candidate !== term));
  }
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFKC");
}

function termFrequency(tokens: string[]) {
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function cjkNgrams(segment: string) {
  if (segment.length <= 2) return [segment];
  const tokens = [segment];
  for (const width of [2, 3, 4]) {
    if (segment.length < width) continue;
    for (let index = 0; index <= segment.length - width; index += 1) {
      tokens.push(segment.slice(index, index + width));
    }
  }
  return tokens;
}

export function tokenizeKnowledgeText(value: string) {
  const normalized = normalizeText(value);
  const latin = normalized.match(/[a-z0-9_][a-z0-9_.:/-]*/g) ?? [];
  const cjk = (normalized.match(/[\p{Script=Han}]+/gu) ?? []).flatMap(cjkNgrams);
  return [...latin, ...cjk].filter((token) => token.length >= 2);
}

function expandQueryTokens(tokens: string[]) {
  const expanded: string[] = [];
  const seen = new Set<string>();
  const add = (token: string) => {
    if (!token || seen.has(token) || expanded.length >= QUERY_TOKEN_LIMIT) return;
    seen.add(token);
    expanded.push(token);
  };
  for (const token of tokens) add(token);
  for (const token of tokens) {
    for (const synonym of SYNONYM_LOOKUP.get(token) ?? []) add(synonym);
  }
  return expanded;
}

export function extractKnowledgeIdentifiers(value: string) {
  const normalized = normalizeText(value);
  const identifiers = normalized.match(/(?:https?:\/\/[^\s)\]}>,]+)|(?:[a-z]:[\\/][^\s)\]}>,]+)|(?:\b(?:[a-z]+[-_.:/])+(?:[a-z0-9]+[-_.:/]*)+\b)|(?:\b[a-z]*\d+[a-z0-9_.:/-]*\b)/gi) ?? [];
  return Array.from(new Set(identifiers.map((item) => item.replace(/[.,;:!?]+$/g, ""))));
}

export function buildKnowledgeLexicalIndex(documents: KnowledgeLexicalDocument[]): KnowledgeLexicalIndex {
  const indexed = documents.map((document) => {
    const titleTokens = tokenizeKnowledgeText(document.rel);
    const bodyTokens = tokenizeKnowledgeText(document.content);
    return {
      ...document,
      titleTokens,
      bodyTokens,
      titleTermFrequency: termFrequency(titleTokens),
      bodyTermFrequency: termFrequency(bodyTokens),
      normalizedTitle: normalizeText(document.rel),
      normalizedBody: normalizeText(document.content),
      identifiers: new Set(extractKnowledgeIdentifiers(`${document.rel}\n${document.content}`)),
    };
  });
  const documentFrequency = new Map<string, number>();
  for (const document of indexed) {
    const uniqueTerms = new Set([...document.titleTokens, ...document.bodyTokens]);
    for (const term of uniqueTerms) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const averageBodyLength = indexed.length
    ? indexed.reduce((sum, document) => sum + document.bodyTokens.length, 0) / indexed.length
    : 0;
  return { documents: indexed, documentFrequency, averageBodyLength };
}

function inverseDocumentFrequency(totalDocuments: number, documentFrequency: number) {
  return Math.log(1 + (totalDocuments - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

function bm25TermScore(termFrequencyValue: number, documentLength: number, averageDocumentLength: number) {
  if (!termFrequencyValue) return 0;
  const normalization = 1 - BM25_B + BM25_B * (documentLength / Math.max(1, averageDocumentLength));
  return (termFrequencyValue * (BM25_K1 + 1)) / (termFrequencyValue + BM25_K1 * normalization);
}

function groupChunkResultsByFile(results: KnowledgeLexicalResult[], maxFiles: number) {
  const byRel = new Map<string, KnowledgeLexicalResult[]>();
  for (const result of results) {
    const entries = byRel.get(result.rel) ?? [];
    entries.push(result);
    byRel.set(result.rel, entries);
  }
  return Array.from(byRel.entries())
    .map(([rel, entries]) => {
      const ranked = entries.sort((left, right) => right.score - left.score);
      const best = ranked[0];
      return {
        ...best,
        rel,
        content: ranked.slice(0, 3).map((entry) => entry.content).join("\n\n...\n\n"),
      };
    })
    .sort((left, right) => right.score - left.score || left.rel.localeCompare(right.rel))
    .slice(0, maxFiles);
}

export function searchKnowledgeLexicalIndex(
  index: KnowledgeLexicalIndex,
  query: string,
  maxFiles: number,
): Record<KnowledgeLexicalChannel, KnowledgeLexicalResult[]> {
  const originalTokens = Array.from(new Set(tokenizeKnowledgeText(query))).slice(0, QUERY_TOKEN_LIMIT);
  const queryTokens = expandQueryTokens(originalTokens);
  const queryIdentifiers = extractKnowledgeIdentifiers(query);
  const totalDocuments = index.documents.length;
  const bm25: KnowledgeLexicalResult[] = [];
  const title: KnowledgeLexicalResult[] = [];
  const exact: KnowledgeLexicalResult[] = [];

  for (const document of index.documents) {
    let bodyScore = 0;
    let titleScore = 0;
    for (const token of queryTokens) {
      const df = index.documentFrequency.get(token) ?? 0;
      if (!df) continue;
      const idf = inverseDocumentFrequency(totalDocuments, df);
      const bodyTf = document.bodyTermFrequency.get(token) ?? 0;
      const titleTf = document.titleTermFrequency.get(token) ?? 0;
      bodyScore += idf * bm25TermScore(bodyTf, document.bodyTokens.length, index.averageBodyLength);
      titleScore += idf * Math.log1p(titleTf) * 3.2;
    }

    if (bodyScore > 0) bm25.push({ ...document, score: bodyScore, channel: "bm25" });
    if (titleScore > 0) title.push({ ...document, score: titleScore, channel: "title" });

    const identifierMatches = queryIdentifiers.filter((identifier) => document.identifiers.has(identifier));
    const compactQuery = normalizeText(query).replace(/\s+/g, "").slice(0, 120);
    const compactTitle = document.normalizedTitle.replace(/\s+/g, "");
    const exactPhraseMatch = compactQuery.length >= 2 && compactQuery.length <= 48 && compactTitle.includes(compactQuery);
    const exactScore = identifierMatches.length * 8 + (exactPhraseMatch ? 6 : 0);
    if (exactScore > 0) exact.push({ ...document, score: exactScore, channel: "exact" });
  }

  const candidateLimit = Math.max(maxFiles * 4, maxFiles);
  return {
    bm25: groupChunkResultsByFile(bm25, candidateLimit),
    title: groupChunkResultsByFile(title, candidateLimit),
    exact: groupChunkResultsByFile(exact, candidateLimit),
  };
}
