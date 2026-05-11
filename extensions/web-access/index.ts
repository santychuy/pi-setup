import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import pLimit from "p-limit";
import { search } from "./search.js";
import { extractContent } from "./extract.js";
import {
  loadConfig,
  getExaApiKey,
  getBraveApiKey,
  errorMessage,
  type ExtractedContent,
} from "./utils.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProviderStatus {
  exa: "mcp" | "api" | "unavailable";
  brave: "key-set" | "missing";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type WebThemeColor = "accent" | "success" | "error" | "warning" | "muted" | "toolTitle";
type WebRenderTheme = {
  fg: (color: WebThemeColor, text: string) => string;
  bold: (text: string) => string;
};

const computeProviderStatus = (): ProviderStatus => {
  const exaKey = getExaApiKey();
  return {
    exa: exaKey ? "api" : "mcp",
    brave: getBraveApiKey() ? "key-set" : "missing",
  };
};

const formatStatus = (pi: ExtensionAPI, ctx: ExtensionContext): string => {
  const status = computeProviderStatus();
  const theme = ctx.ui.theme;
  const lines: string[] = [];

  lines.push(theme.fg("accent", "── Web Search Status ──"));

  const exaLabel =
    status.exa === "api"
      ? theme.fg("success", "✓ API key set")
      : status.exa === "mcp"
        ? theme.fg("success", "✓ MCP (zero-config)")
        : theme.fg("error", "✗ unavailable");
  lines.push(`  Exa:   ${exaLabel}`);

  const braveLabel =
    status.brave === "key-set"
      ? theme.fg("success", "✓ API key set")
      : theme.fg("warning", "✗ missing");
  lines.push(`  Brave: ${braveLabel}`);

  const config = loadConfig();
  lines.push(`  Provider: ${config.provider ?? "auto"}`);

  return lines.join("\n");
};

const normalizeQueryList = (raw: unknown[]): string[] => {
  return raw
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter((q) => q.length > 0);
};

const normalizeNumResults = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.min(20, Math.max(1, Math.floor(value)));
};

const fetchIncludedContent = async (
  urls: string[],
  signal: AbortSignal | undefined,
  onUpdate:
    | ((update: {
        content: Array<{ type: "text"; text: string }>;
        details: Record<string, unknown> | undefined;
      }) => void)
    | undefined,
): Promise<ExtractedContent[]> => {
  const limit = pLimit(3);
  const uniqueUrls = [...new Set(urls)].slice(0, 10);

  const tasks = uniqueUrls.map((url, index) =>
    limit(async () => {
      onUpdate?.({
        content: [
          {
            type: "text" as const,
            text: `Fetching content ${index + 1}/${uniqueUrls.length}: ${url}`,
          },
        ],
        details: {
          phase: "fetching_content",
          progress: index / uniqueUrls.length,
          currentQuery: url,
        },
      });

      try {
        return await extractContent(url, signal);
      } catch (err) {
        return { url, title: "", content: "", error: errorMessage(err) };
      }
    }),
  );

  return Promise.all(tasks);
};

// ── Static render helpers (no ctx dependency) ────────────────────────────────

const renderSearchCall = (
  args: { query?: string; queries?: string[] },
  theme: WebRenderTheme,
): Text => {
  const raw: unknown[] = Array.isArray(args.queries)
    ? args.queries
    : args.query !== undefined
      ? [args.query]
      : [];
  const list = normalizeQueryList(raw);

  if (list.length === 0) {
    return new Text(
      theme.fg("toolTitle", theme.bold("search ")) + theme.fg("error", "(no query)"),
      0,
      0,
    );
  }

  if (list.length === 1) {
    const q = list[0];
    const display = q.length > 60 ? q.slice(0, 57) + "..." : q;
    return new Text(
      theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`),
      0,
      0,
    );
  }

  const lines = [
    theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `${list.length} queries`),
  ];
  for (const q of list.slice(0, 5)) {
    const display = q.length > 50 ? q.slice(0, 47) + "..." : q;
    lines.push(theme.fg("muted", `  "${display}"`));
  }
  if (list.length > 5) {
    lines.push(theme.fg("muted", `  ... and ${list.length - 5} more`));
  }
  return new Text(lines.join("\n"), 0, 0);
};

const renderSearchResult = (
  result: { content?: Array<{ type: string; text?: string }>; details?: Record<string, unknown> },
  options: { expanded: boolean; isPartial: boolean },
  theme: WebRenderTheme,
): Text => {
  const details = result.details as
    | {
        queryCount?: number;
        successfulQueries?: number;
        totalResults?: number;
        error?: string;
        phase?: string;
        progress?: number;
        currentQuery?: string;
        provider?: string;
      }
    | undefined;

  if (options.isPartial) {
    if (details?.phase === "searching") {
      const progress = details.progress ?? 0;
      const bar =
        "\u2588".repeat(Math.floor(progress * 10)) +
        "\u2591".repeat(10 - Math.floor(progress * 10));
      const query = details.currentQuery ?? "";
      const display = query.length > 40 ? query.slice(0, 37) + "..." : query;
      return new Text(theme.fg("accent", `[${bar}] ${display}`), 0, 0);
    }
    return new Text(theme.fg("accent", "searching..."), 0, 0);
  }

  if (details?.error) {
    return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
  }

  const queryInfo =
    details?.queryCount === 1
      ? ""
      : `${details?.successfulQueries}/${details?.queryCount} queries, `;
  const providerInfo = details?.provider ? ` via ${details.provider}` : "";
  return new Text(
    theme.fg("success", `${queryInfo}${details?.totalResults ?? 0} sources${providerInfo}`),
    0,
    0,
  );
};

// ── Config for request scoped progress updates ───────────────────────────────

// ── Extension entrypoint ─────────────────────────────────────────────────────

const webAccessExtension = (pi: ExtensionAPI) => {
  // ── Session lifecycle ──────────────────────────────────────────────────────

  pi.on("session_start", () => {
    // Clean slate on session start
  });

  pi.on("session_shutdown", () => {
    // Cleanup if needed
  });

  // ── Tool: web_search ───────────────────────────────────────────────────────

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web when the user asks for current/external information but does not provide a specific URL to fetch. " +
      "Use this for topics, names, domains, documentation lookup, comparisons, recent information, or broad research. " +
      "Do not use this when the user provides a direct http/https URL and asks to read/fetch/summarize that page; use fetch_content instead. " +
      "Search uses Exa (MCP zero-config, or API with key) or Brave Search (needs API key), and returns a synthesized answer with source citations. " +
      "For comprehensive research, prefer queries (plural) with 2-4 varied angles. " +
      "Provider auto-selects: Exa first (MCP if no key, API if key set), then Brave (needs key).",
    promptSnippet:
      "Routing: use web_search when no direct URL is provided and the user needs web/current/external info. If a URL is present and the request is to read/fetch/summarize that page, use fetch_content. Prefer {queries:[...]} with 2-4 varied angles for research.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: "Single search query. For research, prefer 'queries' with multiple angles.",
        }),
      ),
      queries: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Multiple queries searched in sequence. Vary phrasing and scope across 2-4 queries for best coverage.",
        }),
      ),
      numResults: Type.Optional(
        Type.Number({ description: "Results per query (default: 5, max: 20)" }),
      ),
      includeContent: Type.Optional(
        Type.Boolean({ description: "Also fetch full page content for sources" }),
      ),
      recencyFilter: Type.Optional(
        StringEnum(["day", "week", "month", "year"], { description: "Filter by recency" }),
      ),
      domainFilter: Type.Optional(
        Type.Array(Type.String(), { description: "Limit to domains (prefix with - to exclude)" }),
      ),
      provider: Type.Optional(
        StringEnum(["auto", "exa", "brave"], { description: "Search provider (default: auto)" }),
      ),
    }),

    execute: async (
      _toolCallId: string,
      params: {
        query?: string;
        queries?: string[];
        numResults?: number;
        includeContent?: boolean;
        recencyFilter?: "day" | "week" | "month" | "year";
        domainFilter?: string[];
        provider?: string;
      },
      signal: AbortSignal | undefined,
      onUpdate:
        | ((update: {
            content: Array<{ type: "text"; text: string }>;
            details: Record<string, unknown> | undefined;
          }) => void)
        | undefined,
      _ctx: ExtensionContext,
    ) => {
      const rawQueryList: unknown[] = Array.isArray(params.queries)
        ? params.queries
        : params.query !== undefined
          ? [params.query]
          : [];
      const queryList = normalizeQueryList(rawQueryList);

      if (queryList.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: No query provided. Use 'query' or 'queries' parameter.",
            },
          ],
          details: { error: "No query provided" },
        };
      }

      const results: Array<{
        query: string;
        answer: string;
        results: Array<{ title: string; url: string; snippet: string }>;
        includedContent?: ExtractedContent[];
        error: string | null;
        provider?: string;
      }> = [];
      const allUrls: string[] = [];
      let lastProvider: string | undefined;

      for (let i = 0; i < queryList.length; i++) {
        const query = queryList[i];

        onUpdate?.({
          content: [
            {
              type: "text" as const,
              text: `Searching ${i + 1}/${queryList.length}: "${query}"...`,
            },
          ],
          details: { phase: "searching", progress: i / queryList.length, currentQuery: query },
        });

        try {
          const response = await search(query, {
            numResults: normalizeNumResults(params.numResults),
            includeContent: params.includeContent,
            recencyFilter: params.recencyFilter,
            domainFilter: params.domainFilter,
            signal,
            provider: params.provider,
          });

          results.push({
            query,
            answer: response.answer,
            results: response.results,
            includedContent: response.inlineContent,
            error: null,
            provider: response.provider,
          });
          lastProvider = response.provider;

          for (const r of response.results) {
            if (!allUrls.includes(r.url)) allUrls.push(r.url);
          }
        } catch (err) {
          const message = errorMessage(err);
          if (message.toLowerCase().includes("abort")) throw err;
          results.push({ query, answer: "", results: [], error: message, provider: undefined });
        }

        if (signal?.aborted) break;
      }

      const successfulCount = results.filter((r) => !r.error).length;
      const totalResults = results.reduce((sum, r) => sum + r.results.length, 0);

      let fetchedContent: ExtractedContent[] = [];
      if (params.includeContent && allUrls.length > 0 && !signal?.aborted) {
        const inlineContent = results.flatMap((r) => r.includedContent ?? []);
        const inlineUrls = new Set(inlineContent.map((item) => item.url));
        const urlsToFetch = allUrls.filter((url) => !inlineUrls.has(url));
        const extractedContent = await fetchIncludedContent(urlsToFetch, signal, onUpdate);
        fetchedContent = [...inlineContent, ...extractedContent];
      }

      // Build output
      let output = "";
      for (const r of results) {
        if (queryList.length > 1) {
          output += `## Query: "${r.query}"\n\n`;
        }
        if (r.error) {
          output += `Error: ${r.error}\n\n`;
        } else if (r.results.length === 0) {
          output += "No results found.\n\n";
        } else {
          output += r.answer ? `${r.answer}\n\n---\n\n**Sources:**\n` : "**Sources:**\n";
          output += r.results.map((s, i) => `${i + 1}. ${s.title}\n   ${s.url}`).join("\n\n");
          output += "\n\n";
        }
      }

      if (fetchedContent.length > 0) {
        output += "---\n\n**Fetched Content:**\n\n";
        for (const item of fetchedContent) {
          output += `### ${item.title || item.url}\n${item.url}\n\n`;
          if (item.error) {
            output += `Fetch error: ${item.error}\n\n`;
          } else {
            output += `${item.content.slice(0, 12000)}\n\n`;
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: output.trim() }],
        details: {
          queries: queryList,
          queryCount: queryList.length,
          successfulQueries: successfulCount,
          totalResults,
          fetchedContent: fetchedContent.length,
          provider: lastProvider,
        },
      };
    },

    renderCall: renderSearchCall,

    renderResult: renderSearchResult,
  });

  // ── Tool: fetch_content ────────────────────────────────────────────────────

  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description:
      "Fetch a specific http/https URL provided by the user and extract its readable content as markdown. " +
      "Use this whenever the user provides a direct URL and asks to fetch, read, inspect, extract, summarize, analyze, or tell them what is on that page. " +
      "Do not use this for broad topic research without a specific URL; use web_search instead. " +
      "Handles standard HTML pages (via Readability) and falls back to Jina Reader for JavaScript-rendered pages. " +
      "Returns clean markdown suitable for reading or analysis.",
    promptSnippet:
      "Routing: use fetch_content when the user provides a direct http/https URL or explicitly asks to fetch/read/summarize a page. Use web_search instead when no direct URL is provided.",
    parameters: Type.Object({
      url: Type.String({
        description: "The URL to fetch and extract content from (http/https only)",
      }),
    }),

    execute: async (
      _toolCallId: string,
      params: { url: string },
      signal: AbortSignal | undefined,
      _onUpdate: undefined,
      _ctx: ExtensionContext,
    ) => {
      try {
        const result = await extractContent(params.url, signal);

        if (result.error) {
          return {
            content: [
              { type: "text" as const, text: `Failed to fetch ${params.url}: ${result.error}` },
            ],
            details: { url: params.url, title: result.title, error: result.error },
          };
        }

        return {
          content: [{ type: "text" as const, text: result.content }],
          details: { url: params.url, title: result.title },
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `Failed to fetch ${params.url}: ${errorMessage(err)}` },
          ],
          details: { url: params.url, error: errorMessage(err) },
        };
      }
    },

    renderCall: (args: { url: string }, theme: WebRenderTheme): Text => {
      const url = args.url;
      const display = url.length > 70 ? url.slice(0, 67) + "..." : url;
      return new Text(
        theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display),
        0,
        0,
      );
    },

    renderResult: (
      result: {
        content?: Array<{ type: string; text?: string }>;
        details?: Record<string, unknown>;
      },
      _options: { expanded: boolean; isPartial: boolean },
      theme: WebRenderTheme,
    ): Text => {
      const details = result.details as { title?: string; error?: string } | undefined;
      if (details?.error) {
        return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
      }
      const title = details?.title ? `"${details.title}"` : "";
      return new Text(theme.fg("success", `Fetched ${title}`), 0, 0);
    },
  });

  // ── Command: /web-status ─────────────────────────────────────────────────────

  pi.registerCommand("web-status", {
    description: "Show available search providers and config status",
    handler: async (_args: string, ctx: ExtensionContext) => {
      ctx.ui.notify(formatStatus(pi, ctx), "info");
    },
  });
};

export default webAccessExtension;
