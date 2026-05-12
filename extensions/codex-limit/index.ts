import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

/**
 * Base URL for the Codex usage backend API.
 * Override with CODEX_BASE_URL when testing against a proxy/mock server.
 */
const CODEX_BASE_URL = (process.env.CODEX_BASE_URL || "https://chatgpt.com/backend-api").replace(
  /\/+$/,
  "",
);
const USAGE_ENDPOINT = `${CODEX_BASE_URL}/wham/usage`;
const USAGE_DASHBOARD_URL = "https://chatgpt.com/codex/settings/usage";
const OPEN_DASHBOARD_OPTION = `Open usage dashboard: ${USAGE_DASHBOARD_URL}`;
const OPENAI_AUTH_CLAIM = "https://api.openai.com/auth";
const OPENAI_PROFILE_CLAIM = "https://api.openai.com/profile";
const CODEX_ACCOUNT_ID_CLAIM = "https://api.openai.com/auth.chatgpt_account_id";
const FIVE_HOUR_SECONDS = 5 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const WIDGET_KEY = "codex-limit-render-hook";
const STATUS_KEY = "codex-limit-usage";
const GLOBAL_USAGE_KEY = "piCodexLimit";

/** A normalized rate-limit window from Codex's usage endpoint. */
type UsageWindow = {
  /** Used percentage reported by Codex, usually 0-100. */
  usedPercent?: number;
  /** Window duration in seconds, used to identify 5-hour vs weekly buckets. */
  windowSeconds?: number;
  /** Unix timestamp in seconds for when this limit resets. */
  resetAt?: number;
};

/** Cached, normalized snapshot used by both the footer widget and command. */
type UsageSnapshot = {
  planType?: string;
  email?: string;
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
  /** Local timestamp in milliseconds when the snapshot was fetched. */
  fetchedAt: number;
};

/** Metadata extracted from the OAuth JWT when the API response omits it. */
type JwtMetadata = {
  accountId?: string;
  planType?: string;
  email?: string;
};

type GlobalCodexLimit = {
  provider?: string;
  fiveHour?: UsageWindow;
  weekly?: UsageWindow;
  fetchedAt?: number;
};

declare global {
  // eslint-disable-next-line no-var
  var piCodexLimit: GlobalCodexLimit | undefined;
}

/** Module-level cache; cleared on failed fetches to avoid showing stale data. */
let usageSnapshot: UsageSnapshot | undefined;
/** Updated by the render-hook widget so async refreshes can trigger a repaint. */
let requestRender = () => {};

/** Matches Codex subscription-backed providers only. */
function isOpenAICodexProvider(provider: string | undefined): boolean {
  return /^openai-codex(-\d+)?$/.test(provider ?? "");
}

/** Safely narrow unknown JSON values to plain objects. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nestedRecord(record: Record<string, unknown> | undefined, key: string) {
  return asRecord(record?.[key]);
}

/** Decode the payload portion of an OAuth JWT without validating the signature. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) return {};

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/** Extract account id, plan, and email hints embedded in Codex OAuth tokens. */
function getTokenMetadata(token: string): JwtMetadata {
  const payload = decodeJwtPayload(token);
  const auth = nestedRecord(payload, OPENAI_AUTH_CLAIM);
  const profile = nestedRecord(payload, OPENAI_PROFILE_CLAIM);

  return {
    accountId:
      (typeof payload[CODEX_ACCOUNT_ID_CLAIM] === "string"
        ? payload[CODEX_ACCOUNT_ID_CLAIM]
        : undefined) ??
      (typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined),
    planType: typeof auth?.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : undefined,
    email: typeof profile?.email === "string" ? profile.email : undefined,
  };
}

/** Convert a raw `rate_limit.*_window` object into our internal shape. */
function normalizeWindow(value: unknown): UsageWindow | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    usedPercent: typeof record.used_percent === "number" ? record.used_percent : undefined,
    windowSeconds:
      typeof record.limit_window_seconds === "number" ? record.limit_window_seconds : undefined,
    resetAt: typeof record.reset_at === "number" ? record.reset_at : undefined,
  };
}

/** Parse Codex's `/wham/usage` response and identify 5-hour and weekly windows. */
function parseUsageSnapshot(data: unknown): UsageSnapshot {
  const raw = asRecord(data);
  const rateLimit = nestedRecord(raw, "rate_limit");
  const windows = [
    normalizeWindow(rateLimit?.primary_window),
    normalizeWindow(rateLimit?.secondary_window),
  ].filter((window): window is UsageWindow => Boolean(window));

  return {
    planType: typeof raw?.plan_type === "string" ? raw.plan_type : undefined,
    email: typeof raw?.email === "string" ? raw.email : undefined,
    fiveHour: windows.find(
      (window) => Math.abs((window.windowSeconds ?? 0) - FIVE_HOUR_SECONDS) <= 120,
    ),
    weekly: windows.find((window) => Math.abs((window.windowSeconds ?? 0) - WEEK_SECONDS) <= 120),
    fetchedAt: Date.now(),
  };
}

function clampPercent(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, Math.min(100, value));
}

function formatUsedPercent(window: UsageWindow | undefined): string {
  const used = clampPercent(window?.usedPercent);
  return used === undefined ? "?%" : `${Math.round(used)}%`;
}

function formatRemainingPercent(window: UsageWindow | undefined): string {
  const used = clampPercent(window?.usedPercent);
  return used === undefined ? "?%" : `${Math.round(100 - used)}%`;
}

/** Mask account email for command output while keeping it recognizable. */
function maskEmail(email: string): string {
  const [rawLocal, rawDomain] = email.split("@");
  if (!rawLocal || !rawDomain) return "***";

  const local = rawLocal.length <= 2 ? `${rawLocal[0] ?? ""}***` : `${rawLocal.slice(0, 2)}***`;
  const [domainName, ...domainRest] = rawDomain.split(".");
  const maskedDomain = domainName
    ? `${domainName[0] ?? ""}***${domainName.length > 1 ? domainName.slice(-1) : ""}`
    : "***";
  return `${local}@${maskedDomain}${domainRest.length > 0 ? `.${domainRest.join(".")}` : ""}`;
}

function formatFetchedAt(fetchedAt: number): string {
  return new Date(fetchedAt).toLocaleString();
}

/** Format reset timestamps for compact human-readable UI text. */
function formatResetLong(resetAt: number | undefined): string {
  if (!resetAt) return "unknown";

  const minutes = Math.max(0, Math.round((resetAt * 1000 - Date.now()) / 60000));
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;

  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

function publishSnapshot(ctx: ExtensionContext, snapshot: UsageSnapshot | undefined) {
  globalThis[GLOBAL_USAGE_KEY] = snapshot
    ? {
        provider: ctx.model?.provider,
        fiveHour: snapshot.fiveHour,
        weekly: snapshot.weekly,
        fetchedAt: snapshot.fetchedAt,
      }
    : undefined;
}

/** Update pi's built-in footer status so users without a custom footer still see usage. */
function publishFooterStatus(ctx: ExtensionContext, snapshot: UsageSnapshot | undefined) {
  if (!ctx.hasUI) return;

  if (!isOpenAICodexProvider(ctx.model?.provider)) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const used = clampPercent(snapshot?.fiveHour?.usedPercent);
  if (used === undefined) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const label = `Codex usage limit: ${Math.round(used)}%`;
  const color = used >= 90 ? "error" : used >= 70 ? "warning" : "success";
  ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color, label));
}

/**
 * Fetch and cache the current Codex usage snapshot.
 *
 * This only runs for OAuth-backed openai-codex models. Failures clear the cache so
 * the footer never displays stale limits.
 */
async function updateUsage(ctx: ExtensionContext): Promise<UsageSnapshot | undefined> {
  const model = ctx.model;
  if (!model || !isOpenAICodexProvider(model.provider) || !ctx.modelRegistry.isUsingOAuth(model)) {
    usageSnapshot = undefined;
    publishSnapshot(ctx, undefined);
    publishFooterStatus(ctx, undefined);
    requestRender();
    return undefined;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    usageSnapshot = undefined;
    publishSnapshot(ctx, undefined);
    publishFooterStatus(ctx, undefined);
    requestRender();
    return undefined;
  }

  const metadata = getTokenMetadata(auth.apiKey);
  const headers = {
    Authorization: `Bearer ${auth.apiKey}`,
    Accept: "application/json",
    "User-Agent": "pi-codex-limit",
    ...(metadata.accountId ? { "chatgpt-account-id": metadata.accountId } : {}),
  };

  try {
    const response = await fetch(USAGE_ENDPOINT, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      usageSnapshot = undefined;
      publishSnapshot(ctx, undefined);
      publishFooterStatus(ctx, undefined);
      requestRender();
      return undefined;
    }

    const snapshot = parseUsageSnapshot(await response.json());
    usageSnapshot = {
      ...snapshot,
      email: snapshot.email ?? metadata.email,
      planType: snapshot.planType ?? metadata.planType,
    };
    publishSnapshot(ctx, usageSnapshot);
    publishFooterStatus(ctx, usageSnapshot);
    requestRender();
    return usageSnapshot;
  } catch {
    usageSnapshot = undefined;
    publishSnapshot(ctx, undefined);
    publishFooterStatus(ctx, undefined);
    requestRender();
    return undefined;
  }
}

/** Build the selectable detail rows shown by `/codex-limit`. */
function buildUsageDetails(snapshot: UsageSnapshot): string[] {
  return [
    `plan: ${snapshot.planType ?? "unknown"}`,
    ...(snapshot.email ? [`email: ${maskEmail(snapshot.email)}`] : []),
    `5-hour: ${formatUsedPercent(snapshot.fiveHour)} used, ${formatRemainingPercent(snapshot.fiveHour)} left, resets ${formatResetLong(snapshot.fiveHour?.resetAt)}`,
    `weekly: ${formatUsedPercent(snapshot.weekly)} used, ${formatRemainingPercent(snapshot.weekly)} left, resets ${formatResetLong(snapshot.weekly?.resetAt)}`,
    OPEN_DASHBOARD_OPTION,
  ];
}

function getOpenCommand(url: string): { command: string; args: string[] } {
  if (process.platform === "darwin") return { command: "open", args: [url] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

async function openUsageDashboard(pi: ExtensionAPI, ctx: ExtensionContext) {
  const { command, args } = getOpenCommand(USAGE_DASHBOARD_URL);
  const result = await pi.exec(command, args).catch(() => undefined);
  if (result) {
    ctx.ui.notify("Opened Codex usage dashboard in your browser.", "info");
  } else {
    ctx.ui.notify(`Could not open browser. Visit: ${USAGE_DASHBOARD_URL}`, "warning");
  }
}

function buildUsageTitle(ctx: ExtensionContext, snapshot: UsageSnapshot): string {
  return `Codex usage limits ${ctx.ui.theme.fg("dim", `(fetched: ${formatFetchedAt(snapshot.fetchedAt)})`)}`;
}

async function showUsageDetails(ctx: ExtensionContext, snapshot: UsageSnapshot) {
  const title = buildUsageTitle(ctx, snapshot);
  const details = buildUsageDetails(snapshot);
  const actionIndex = details.indexOf(OPEN_DASHBOARD_OPTION);

  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    let selectedIndex = 0;
    let cachedLines: string[] | undefined;

    const refresh = () => {
      cachedLines = undefined;
      tui.requestRender();
    };

    const handleInput = (data: string) => {
      if (matchesKey(data, Key.up) || data === "k") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        refresh();
        return;
      }

      if (matchesKey(data, Key.down) || data === "j") {
        selectedIndex = Math.min(details.length - 1, selectedIndex + 1);
        refresh();
        return;
      }

      if (matchesKey(data, Key.enter) && selectedIndex === actionIndex) {
        done(OPEN_DASHBOARD_OPTION);
        return;
      }

      if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
        done(undefined);
      }
    };

    const render = (width: number): string[] => {
      if (cachedLines) return cachedLines;

      const lines: string[] = [];
      const add = (line: string) => lines.push(truncateToWidth(line, width));
      const selectedAction = selectedIndex === actionIndex;

      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(` ${title}`)));
      lines.push("");

      for (let i = 0; i < details.length; i++) {
        const selected = i === selectedIndex;
        const actionable = i === actionIndex;
        const prefix = selected ? theme.fg("accent", "→ ") : "  ";
        const color = selected ? "accent" : actionable ? "text" : "muted";
        add(prefix + theme.fg(color, details[i]));
      }

      lines.push("");
      add(
        theme.fg(
          "dim",
          selectedAction
            ? "↑↓ navigate • Enter to open usage dashboard • Esc/Ctrl+C cancel"
            : "↑↓ navigate • Esc/Ctrl+C cancel",
        ),
      );
      add(theme.fg("accent", "─".repeat(width)));

      cachedLines = lines;
      return lines;
    };

    return {
      invalidate() {
        cachedLines = undefined;
      },
      handleInput,
      render,
    };
  });
}

/** Install an invisible render hook so async refreshes repaint the footer-mode widget. */
function installWidget(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;

  ctx.ui.setWidget(
    WIDGET_KEY,
    (tui) => {
      requestRender = () => tui.requestRender();
      return {
        invalidate() {},
        render(): string[] {
          return [];
        },
      };
    },
    { placement: "belowEditor" },
  );
}

/** Register lifecycle hooks and the `/codex-limit` command. */
export default function (pi: ExtensionAPI): void {
  let inFlight: Promise<UsageSnapshot | undefined> = Promise.resolve(undefined);

  /** Serialize refreshes so model changes and agent_end cannot fetch concurrently. */
  const queueUpdate = (ctx: ExtensionContext) => {
    inFlight = inFlight.catch(() => undefined).then(() => updateUsage(ctx));
    return inFlight;
  };

  pi.on("session_start", (_event, ctx) => {
    installWidget(ctx);
    void queueUpdate(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    void queueUpdate(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    void queueUpdate(ctx);
  });

  pi.on("session_shutdown", () => {
    usageSnapshot = undefined;
    globalThis[GLOBAL_USAGE_KEY] = undefined;
    requestRender = () => {};
  });

  pi.registerCommand("codex-limit", {
    description: "Show Codex 5-hour and weekly usage limits",
    handler: async (_args, ctx) => {
      if (!isOpenAICodexProvider(ctx.model?.provider)) {
        ctx.ui.notify("Codex limits are only available for openai-codex models.", "info");
        return;
      }

      const snapshot = await queueUpdate(ctx);
      if (!snapshot) {
        ctx.ui.notify("Could not load Codex usage limits.", "warning");
        return;
      }

      const selected = await showUsageDetails(ctx, snapshot);
      if (selected === OPEN_DASHBOARD_OPTION) await openUsageDashboard(pi, ctx);
    },
  });
}
