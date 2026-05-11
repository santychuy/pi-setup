import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(EXTENSION_DIR, "web-search.json");

export interface WebSearchConfig {
  exaApiKey?: string;
  braveApiKey?: string;
  provider?: SearchProvider;
}

export type SearchProvider = "auto" | "exa" | "brave";
export type ResolvedSearchProvider = "exa" | "brave";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
  inlineContent?: ExtractedContent[];
}

export interface AttributedSearchResponse extends SearchResponse {
  provider: ResolvedSearchProvider;
}

export interface SearchOptions {
  numResults?: number;
  includeContent?: boolean;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  signal?: AbortSignal;
}

export interface ExtractedContent {
  url: string;
  title: string;
  content: string;
  error: string | null;
}

let cachedConfig: WebSearchConfig | null = null;

export const loadConfig = (): WebSearchConfig => {
  if (cachedConfig) return cachedConfig;

  if (!existsSync(CONFIG_PATH)) {
    cachedConfig = {};
    return cachedConfig;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    cachedConfig = {
      exaApiKey: normalizeKey(parsed.exaApiKey),
      braveApiKey: normalizeKey(parsed.braveApiKey),
      provider: normalizeProvider(parsed.provider ?? parsed.searchProvider ?? "auto"),
    };
    return cachedConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`, { cause: err });
  }
};

export const saveConfig = (updates: Partial<WebSearchConfig>): void => {
  let config: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
    } catch {
      // ignore parse errors, start fresh
    }
  }

  Object.assign(config, updates);
  if (!existsSync(EXTENSION_DIR)) mkdirSync(EXTENSION_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  cachedConfig = null;
};

const normalizeKey = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const normalizeProvider = (value: unknown): SearchProvider => {
  if (typeof value !== "string") return "auto";
  const normalized = value.trim().toLowerCase();
  if (normalized === "exa") return "exa";
  if (normalized === "brave") return "brave";
  return "auto";
};

export const errorMessage = (err: unknown): string => {
  return err instanceof Error ? err.message : String(err);
};

export const isAbortError = (err: unknown): boolean => {
  return errorMessage(err).toLowerCase().includes("abort");
};

export const freshnessFromRecency = (filter: string | undefined): string | undefined => {
  if (!filter) return undefined;
  const map: Record<string, string> = {
    day: "pd",
    week: "pw",
    month: "pm",
    year: "py",
  };
  return map[filter];
};

export const getApiKey = (keyName: "exaApiKey" | "braveApiKey"): string | undefined => {
  const envVar = keyName === "exaApiKey" ? "EXA_API_KEY" : "BRAVE_API_KEY";
  return process.env[envVar] ?? loadConfig()[keyName];
};

export const getExaApiKey = (): string | undefined => {
  return getApiKey("exaApiKey");
};

export const getBraveApiKey = (): string | undefined => {
  return getApiKey("braveApiKey");
};
