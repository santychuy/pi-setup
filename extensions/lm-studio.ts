import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type LMStudioModel = {
  type: "llm" | "embedding";
  key: string;
  display_name?: string;
  max_context_length?: number;
  loaded_instances?: Array<{ config?: { context_length?: number } }>;
  capabilities?: { vision?: boolean; trained_for_tool_use?: boolean };
};

export default async function (pi: ExtensionAPI) {
  const response = await fetch("http://127.0.0.1:1234/api/v1/models", {
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) throw new Error(`LM Studio model discovery failed: ${response.status}`);

  const payload = (await response.json()) as { models?: LMStudioModel[] };
  const models = (payload.models ?? []).filter((model) => model.type === "llm");

  pi.registerProvider("lm-studio", {
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKey: "lm-studio",
    api: "openai-completions",
    models: models.map((model) => {
      // Match Pi's limit to LM Studio's active instance, not model's theoretical maximum.
      const contextWindow =
        model.loaded_instances?.[0]?.config?.context_length ?? model.max_context_length ?? 8_192;
      return {
        id: model.key,
        name: model.display_name ?? model.key,
        reasoning: false,
        input: model.capabilities?.vision ? ["text", "image"] : ["text"],
        contextWindow,
        maxTokens: Math.min(4_096, Math.floor(contextWindow / 2)),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens" as const,
        },
      };
    }),
  });
}
