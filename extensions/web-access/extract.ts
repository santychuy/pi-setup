import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import type { ExtractedContent } from "./utils";
import { errorMessage } from "./utils";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const JINA_READER_BASE = "https://r.jina.ai/";
const JINA_TIMEOUT_MS = 30000;
const MIN_USEFUL_CONTENT = 500;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const REJECTED_TYPES = [
  "application/octet-stream",
  "image/",
  "audio/",
  "video/",
  "application/zip",
  "application/gzip",
  "application/x-tar",
  "application/x-rar-compressed",
];

const isRejectedContentType = (contentType: string): boolean => {
  const lower = contentType.toLowerCase();
  return REJECTED_TYPES.some((t) => lower.includes(t));
};

const isLikelyJSRendered = (html: string): boolean => {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;

  const textContent = bodyMatch[1]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const scriptCount = (html.match(/<script/gi) || []).length;
  return textContent.length < 500 && scriptCount > 3;
};

const extractHeadingTitle = (text: string): string | null => {
  const match = text.match(/^#{1,2}\s+(.+)/m);
  if (!match) return null;
  const cleaned = match[1].replace(/\*+/g, "").trim();
  return cleaned || null;
};

// ── Jina Reader fallback ─────────────────────────────────────────────────────

const extractWithJinaReader = async (
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> => {
  const jinaUrl = JINA_READER_BASE + url;

  try {
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: "text/markdown",
        "X-No-Cache": "true",
      },
      signal: AbortSignal.any([AbortSignal.timeout(JINA_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    });

    if (!res.ok) return null;

    const content = await res.text();
    const contentStart = content.indexOf("Markdown Content:");
    if (contentStart < 0) return null;

    const markdownPart = content.slice(contentStart + 17).trim();

    if (
      markdownPart.length < 100 ||
      markdownPart.startsWith("Loading...") ||
      markdownPart.startsWith("Please enable JavaScript")
    ) {
      return null;
    }

    const title =
      extractHeadingTitle(markdownPart) ?? (new URL(url).pathname.split("/").pop() || url);
    return { url, title, content: markdownPart, error: null };
  } catch {
    return null;
  }
};

// ── HTTP extraction ──────────────────────────────────────────────────────────

const extractViaHttp = async (url: string, signal?: AbortSignal): Promise<ExtractedContent> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });

    if (!response.ok) {
      return {
        url,
        title: "",
        content: "",
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length");

    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (length > MAX_RESPONSE_SIZE) {
        return {
          url,
          title: "",
          content: "",
          error: `Response too large (${Math.round(length / 1024 / 1024)}MB)`,
        };
      }
    }

    if (isRejectedContentType(contentType)) {
      return {
        url,
        title: "",
        content: "",
        error: `Unsupported content type: ${contentType.split(";")[0]}`,
      };
    }

    const text = await response.text();
    const isHTML =
      contentType.includes("text/html") || contentType.includes("application/xhtml+xml");

    if (!isHTML) {
      const title = extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
      return { url, title, content: text, error: null };
    }

    const { document } = parseHTML(text);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();

    if (!article) {
      const jsRendered = isLikelyJSRendered(text);
      return {
        url,
        title: "",
        content: "",
        error: jsRendered
          ? "Page appears to be JavaScript-rendered (content loads dynamically)"
          : "Could not extract readable content from HTML structure",
      };
    }

    const markdown = turndown.turndown(article.content);

    if (markdown.length < MIN_USEFUL_CONTENT) {
      return {
        url,
        title: article.title || "",
        content: markdown,
        error: isLikelyJSRendered(text)
          ? "Page appears to be JavaScript-rendered (content loads dynamically)"
          : "Extracted content appears incomplete",
      };
    }

    return { url, title: article.title || "", content: markdown, error: null };
  } catch (err) {
    const message = errorMessage(err);
    if (message.toLowerCase().includes("abort")) {
      return { url, title: "", content: "", error: "Aborted" };
    }
    return { url, title: "", content: "", error: message };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
};

// ── Public API ───────────────────────────────────────────────────────────────

export const extractContent = async (
  url: string,
  signal?: AbortSignal,
): Promise<ExtractedContent> => {
  if (signal?.aborted) {
    return { url, title: "", content: "", error: "Aborted" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { url, title: "", content: "", error: "Invalid URL" };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { url, title: "", content: "", error: "Only http:// and https:// URLs are supported" };
  }

  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" };

  const httpResult = await extractViaHttp(url, signal);

  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" };
  if (!httpResult.error) return httpResult;

  // If Readability failed (likely JS-rendered), try Jina Reader
  const jinaResult = await extractWithJinaReader(url, signal);
  if (jinaResult) return jinaResult;

  if (signal?.aborted) return { url, title: "", content: "", error: "Aborted" };

  // Both failed — enhance error message with guidance
  const guidance = [
    httpResult.error,
    "",
    "The page could not be extracted. Try:",
    "  • Use web_search to find information about this topic",
    "  • The page may require login or blocks automated access",
  ].join("\n");

  return { ...httpResult, error: guidance };
};
