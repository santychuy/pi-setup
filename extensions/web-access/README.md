# Web Access Extension

Adds two Pi tools:

- `web_search` — searches the web with Exa or Brave and returns cited sources.
- `fetch_content` — fetches a URL and extracts readable markdown content.

## Providers

### Exa

- Uses `EXA_API_KEY` or `extensions/web-access/web-search.json` when available.
- Falls back to Exa MCP zero-config when no key is configured.
- Direct API usage is locally budgeted at 1,000 requests/month in `~/.pi/exa-usage.json`.

### Brave

- Uses `BRAVE_API_KEY` or `extensions/web-access/web-search.json`.
- Used directly when `provider: "brave"`, or as fallback when Exa fails and a Brave key is available.

## Config

Copy `.web-search.json.example` to `web-search.json` in this extension directory:

```json
{
  "exaApiKey": "exa-...",
  "braveApiKey": "BSA...",
  "provider": "auto"
}
```

Environment variables take precedence:

- `EXA_API_KEY`
- `BRAVE_API_KEY`

## Tool routing

Use `web_search` when the user needs web/current/external information but did not provide a direct URL. Examples: topics, domains, docs lookup, comparisons, recent info, broad research.

Use `fetch_content` when the user provides a direct `http://` or `https://` URL and asks to fetch, read, inspect, summarize, or analyze that page.

## Tool examples

```json
{
  "queries": ["Pi coding agent extensions", "Pi coding agent tools API"],
  "numResults": 5,
  "provider": "auto"
}
```

```json
{
  "url": "https://example.com/article"
}
```
