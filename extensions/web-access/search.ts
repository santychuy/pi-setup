import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type AttributedSearchResponse,
  type ResolvedSearchProvider,
  type SearchOptions,
  type SearchResponse,
  type SearchResult,
  errorMessage,
  freshnessFromRecency,
  getExaApiKey,
  getBraveApiKey,
  loadConfig,
  type ExtractedContent,
} from "./utils";

// ── Exa constants ────────────────────────────────────────────────────────────

const EXA_ANSWER_URL = "https://api.exa.ai/answer";
const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_USAGE_PATH = join(homedir(), ".pi", "exa-usage.json");
const MONTHLY_LIMIT = 1000;
const MCP_TIMEOUT_MS = 60000;

// ── Brave constants ──────────────────────────────────────────────────────────

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

// ── Exa: budget tracking (only applies to direct API usage) ──────────────────

interface ExaUsage {
  month: string;
  count: number;
}

const getCurrentMonth = (): string => {
  return new Date().toISOString().slice(0, 7);
};

const readExaUsage = (): ExaUsage => {
  if (!existsSync(EXA_USAGE_PATH)) return { month: getCurrentMonth(), count: 0 };
  try {
    const raw = JSON.parse(readFileSync(EXA_USAGE_PATH, "utf-8")) as {
      month?: unknown;
      count?: unknown;
    };
    const month = typeof raw.month === "string" ? raw.month : getCurrentMonth();
    const count =
      typeof raw.count === "number" && Number.isFinite(raw.count)
        ? Math.max(0, Math.floor(raw.count))
        : 0;
    if (month !== getCurrentMonth()) return { month: getCurrentMonth(), count: 0 };
    return { month, count };
  } catch {
    return { month: getCurrentMonth(), count: 0 };
  }
};

const writeExaUsage = (usage: ExaUsage): void => {
  const dir = join(homedir(), ".pi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(EXA_USAGE_PATH, JSON.stringify(usage, null, 2) + "\n");
};

const reserveExaBudget = (): { exhausted: true } | null => {
  const usage = readExaUsage();
  if (usage.count >= MONTHLY_LIMIT) return { exhausted: true };
  writeExaUsage({ month: usage.month, count: usage.count + 1 });
  return null;
};

// ── Exa MCP client (zero-config) ─────────────────────────────────────────────

interface ExaMcpRpcResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: {
    code?: number;
    message?: string;
  };
}

const callExaMcp = async (
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> => {
  const timeout = AbortSignal.timeout(MCP_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const response = await fetch(EXA_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Exa MCP error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const body = await response.text();
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));

  let parsed: ExaMcpRpcResponse | null = null;
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const candidate = JSON.parse(payload) as ExaMcpRpcResponse;
      if (candidate?.result || candidate?.error) {
        parsed = candidate;
        break;
      }
    } catch {
      // skip invalid JSON lines
    }
  }

  if (!parsed) {
    try {
      const candidate = JSON.parse(body) as ExaMcpRpcResponse;
      if (candidate?.result || candidate?.error) parsed = candidate;
    } catch {
      // fallback parse failed
    }
  }

  if (!parsed) throw new Error("Exa MCP returned an empty response");

  if (parsed.error) {
    const code = typeof parsed.error.code === "number" ? ` ${parsed.error.code}` : "";
    throw new Error(`Exa MCP error${code}: ${parsed.error.message ?? "Unknown error"}`);
  }

  if (parsed.result?.isError) {
    const message = parsed.result.content
      ?.find((item) => item.type === "text" && typeof item.text === "string")
      ?.text?.trim();
    throw new Error(message || "Exa MCP returned an error");
  }

  const text = parsed.result?.content?.find(
    (item) => item.type === "text" && typeof item.text === "string" && item.text.trim().length > 0,
  )?.text;

  if (!text) throw new Error("Exa MCP returned empty content");
  return text;
};

const parseExaMcpResults = (
  text: string,
): Array<{ title: string; url: string; content: string }> | null => {
  const blocks = text.split(/(?=^Title: )/m).filter((block) => block.trim().length > 0);
  const parsed = blocks
    .map((block) => {
      const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
      const url = block.match(/^URL: (.+)/m)?.[1]?.trim() ?? "";
      let content = "";
      const textStart = block.indexOf("\nText: ");
      if (textStart >= 0) {
        content = block.slice(textStart + 7).trim();
      } else {
        const hlMatch = block.match(/\nHighlights:\s*\n/);
        if (hlMatch?.index != null) {
          content = block.slice(hlMatch.index + hlMatch[0].length).trim();
        }
      }
      content = content.replace(/\n---\s*$/, "").trim();
      return { title, url, content };
    })
    .filter((r) => r.url.length > 0);
  return parsed.length > 0 ? parsed : null;
};

const buildAnswerFromMcpResults = (
  results: Array<{ title: string; url: string; content: string }>,
): string => {
  if (results.length === 0) return "";
  return results
    .map((r, i) => {
      const snippet = r.content.replace(/\s+/g, " ").trim().slice(0, 500);
      if (!snippet) return null;
      return `${snippet}\nSource: ${r.title || `Source ${i + 1}`} (${r.url})`;
    })
    .filter(Boolean)
    .join("\n\n");
};

const mapMcpInlineContent = (
  results: Array<{ title: string; url: string; content: string }>,
): ExtractedContent[] => {
  return results
    .filter((r) => r.content.length > 0)
    .map((r) => ({ url: r.url, title: r.title, content: r.content, error: null }));
};

const buildExaMcpQuery = (query: string, options: SearchOptions): string => {
  const parts = [query];
  if (options.domainFilter?.length) {
    for (const d of options.domainFilter) {
      parts.push(d.startsWith("-") ? `-site:${d.slice(1)}` : `site:${d}`);
    }
  }
  if (options.recencyFilter) {
    const now = new Date();
    switch (options.recencyFilter) {
      case "day":
        parts.push("past 24 hours");
        break;
      case "week":
        parts.push("past week");
        break;
      case "month":
        parts.push(`${now.toLocaleString("en", { month: "long" })} ${now.getFullYear()}`);
        break;
      case "year":
        parts.push(String(now.getFullYear()));
        break;
    }
  }
  return parts.join(" ");
};

const searchWithExaMcp = async (
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse | null> => {
  const enrichedQuery = buildExaMcpQuery(query, options);
  const text = await callExaMcp(
    "web_search_exa",
    {
      query: enrichedQuery,
      numResults: options.numResults ?? 5,
      livecrawl: "fallback",
      type: "auto",
      contextMaxCharacters: options.includeContent ? 50000 : 3000,
    },
    options.signal,
  );

  const parsedResults = parseExaMcpResults(text);
  if (!parsedResults) return null;

  const response: SearchResponse = {
    answer: buildAnswerFromMcpResults(parsedResults),
    results: parsedResults.map((r, i) => ({
      title: r.title || `Source ${i + 1}`,
      url: r.url,
      snippet: "",
    })),
  };

  if (options.includeContent) {
    const inlineContent = mapMcpInlineContent(parsedResults);
    if (inlineContent.length > 0) response.inlineContent = inlineContent;
  }

  return response;
};

// ── Exa direct API client ────────────────────────────────────────────────────

interface ExaAnswerResponse {
  answer?: string;
  citations?: Array<{ url?: string; title?: string; text?: string; publishedDate?: string }>;
}

interface ExaSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    publishedDate?: string;
    author?: string;
    text?: string;
    highlights?: unknown;
    highlightScores?: number[];
  }>;
}

const mapExaResults = (
  results: ExaSearchResponse["results"] | ExaAnswerResponse["citations"],
): SearchResult[] => {
  if (!Array.isArray(results)) return [];
  const mapped: SearchResult[] = [];
  for (const item of results) {
    if (!item?.url) continue;
    mapped.push({
      title: item.title || `Source ${mapped.length + 1}`,
      url: item.url,
      snippet: "",
    });
  }
  return mapped;
};

const buildExaAnswerFromSearchResults = (results: ExaSearchResponse["results"]): string => {
  if (!results?.length) return "";
  return results
    .map((item, i) => {
      if (!item?.url) return null;
      const highlights = Array.isArray(item.highlights)
        ? item.highlights.filter((h): h is string => typeof h === "string" && h.trim().length > 0)
        : [];
      const content =
        highlights.length > 0
          ? highlights.join(" ")
          : typeof item.text === "string"
            ? item.text.trim().slice(0, 1000)
            : "";
      if (!content) return null;
      return `${content}\nSource: ${item.title || `Source ${i + 1}`} (${item.url})`;
    })
    .filter(Boolean)
    .join("\n\n");
};

const mapExaInlineContent = (results: ExaSearchResponse["results"]): ExtractedContent[] => {
  if (!results?.length) return [];
  return results
    .filter(
      (r): r is NonNullable<ExaSearchResponse["results"]>[number] & { url: string; text: string } =>
        !!r?.url && typeof r.text === "string" && r.text.length > 0,
    )
    .map((r) => ({ url: r.url, title: r.title || "", content: r.text, error: null }));
};

const searchWithExaDirect = async (
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> => {
  const budget = reserveExaBudget();
  if (budget) {
    throw new Error(
      "Exa monthly free tier exhausted (1,000 requests). Resets next month.\n" +
        "  Switch to Brave with provider: 'brave', or upgrade at exa.ai/pricing",
    );
  }

  const apiKey = getExaApiKey()!;
  const useSearch =
    options.includeContent ||
    !!options.recencyFilter ||
    !!options.domainFilter?.length ||
    !!(options.numResults && options.numResults !== 5);

  if (!useSearch) {
    const response = await fetch(EXA_ANSWER_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, text: true }),
      signal: AbortSignal.any([
        AbortSignal.timeout(30000),
        ...(options.signal ? [options.signal] : []),
      ]),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Exa API error ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = (await response.json()) as ExaAnswerResponse;
    return {
      answer: data.answer || "",
      results: mapExaResults(data.citations),
    };
  }

  const startDate = options.recencyFilter
    ? new Date(
        Date.now() - { day: 1, week: 7, month: 30, year: 365 }[options.recencyFilter] * 86400000,
      ).toISOString()
    : null;

  const includeDomains = options.domainFilter
    ?.filter((d) => !d.startsWith("-") && d.trim().length > 0)
    .map((d) => d.trim());
  const excludeDomains = options.domainFilter
    ?.filter((d) => d.startsWith("-"))
    .map((d) => d.slice(1).trim())
    .filter(Boolean);

  const response = await fetch(EXA_SEARCH_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: options.numResults ?? 5,
      ...(includeDomains?.length ? { includeDomains } : {}),
      ...(excludeDomains?.length ? { excludeDomains } : {}),
      ...(startDate ? { startPublishedDate: startDate } : {}),
      contents: {
        text: options.includeContent ? true : { maxCharacters: 3000 },
        highlights: true,
      },
    }),
    signal: AbortSignal.any([
      AbortSignal.timeout(30000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Exa API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as ExaSearchResponse;

  const mapped: SearchResponse = {
    answer: buildExaAnswerFromSearchResults(data.results),
    results: mapExaResults(data.results),
  };

  if (options.includeContent) {
    const inlineContent = mapExaInlineContent(data.results);
    if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
  }

  return mapped;
};

// ── Exa public entry ─────────────────────────────────────────────────────────

export const isExaAvailable = (): boolean => {
  const key = getExaApiKey();
  if (key) {
    const usage = readExaUsage();
    return usage.count < MONTHLY_LIMIT;
  }
  return true; // MCP always available
};

export const hasExaApiKey = (): boolean => {
  return !!getExaApiKey();
};

const searchWithExa = async (
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> => {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    const result = await searchWithExaMcp(query, options);
    if (!result) throw new Error("Exa MCP returned no results");
    return result;
  }
  return searchWithExaDirect(query, options);
};

// ── Brave Search client ──────────────────────────────────────────────────────

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  extra_snippets?: string[];
}

interface BraveApiResponse {
  query?: { original?: string };
  web?: {
    results?: BraveWebResult[];
  };
}

const buildBraveAnswer = (results: BraveWebResult[]): string => {
  if (results.length === 0) return "";
  return results
    .map((r, i) => {
      const snippets = [r.description, ...(r.extra_snippets ?? [])].filter(Boolean);
      const combined = snippets.join(" ");
      if (!combined) return null;
      return `${combined}\nSource: ${r.title || `Source ${i + 1}`} (${r.url})`;
    })
    .filter(Boolean)
    .join("\n\n");
};

const searchWithBrave = async (
  query: string,
  options: SearchOptions = {},
): Promise<SearchResponse> => {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    throw new Error(
      "Brave Search API key not found.\n" +
        "  1. Get a free key at https://api.search.brave.com/app/dashboard\n" +
        "  2. Add 'braveApiKey' to extensions/web-access/web-search.json\n" +
        "  3. Or set BRAVE_API_KEY environment variable",
    );
  }

  const url = new URL(BRAVE_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(options.numResults ?? 5, 20)));
  url.searchParams.set("extra_snippets", "true");
  url.searchParams.set("safesearch", "moderate");

  const freshness = freshnessFromRecency(options.recencyFilter);
  if (freshness) url.searchParams.set("freshness", freshness);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.any([
      AbortSignal.timeout(15000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Brave Search API returned unauthorized. Check your braveApiKey in extensions/web-access/web-search.json",
      );
    }
    const errorText = await response.text();
    throw new Error(`Brave API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as BraveApiResponse;
  const results = data.web?.results ?? [];

  return {
    answer: buildBraveAnswer(results),
    results: results
      .filter((r): r is BraveWebResult & { url: string } => !!r.url)
      .map((r) => ({
        title: r.title || "Untitled",
        url: r.url,
        snippet: r.description || "",
      })),
  };
};

// ── Provider availability ────────────────────────────────────────────────────

export const isBraveAvailable = (): boolean => {
  return !!getBraveApiKey();
};

const resolveProvider = (requested: unknown): ResolvedSearchProvider => {
  const config = loadConfig();
  const provider = (typeof requested === "string" ? requested : config.provider) ?? "auto";

  if (provider === "auto") {
    if (isExaAvailable()) return "exa";
    if (isBraveAvailable()) return "brave";
    return "exa";
  }

  if (provider === "exa") return "exa";
  if (provider === "brave") return "brave";
  return "exa";
};

// ── Search router ────────────────────────────────────────────────────────────

export const search = async (
  query: string,
  options: SearchOptions & { provider?: string } = {},
): Promise<AttributedSearchResponse> => {
  const resolvedProvider = resolveProvider(options.provider);

  if (resolvedProvider === "exa") {
    try {
      const result = await searchWithExa(query, options);
      return { ...result, provider: "exa" };
    } catch (err) {
      const message = errorMessage(err);
      if (message.toLowerCase().includes("abort")) throw err;
      if (isBraveAvailable()) {
        try {
          const result = await searchWithBrave(query, options);
          return { ...result, provider: "brave" };
        } catch {
          // both failed
        }
      }
      throw err;
    }
  }

  if (resolvedProvider === "brave") {
    return { ...(await searchWithBrave(query, options)), provider: "brave" };
  }

  throw new Error(`Unknown provider: ${resolvedProvider}`);
};
