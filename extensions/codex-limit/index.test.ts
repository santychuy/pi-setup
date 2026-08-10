import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// @ts-ignore Node's strip-types runner loads the TypeScript source entry directly.
import extension from "./index.ts";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function createContext() {
  let active = true;
  let staleAccesses = 0;

  const context = {
    get hasUI() {
      if (!active) {
        staleAccesses += 1;
        throw new Error("stale context");
      }
      return true;
    },
    get model() {
      return { provider: "openai-codex" };
    },
    get modelRegistry() {
      return {
        isUsingOAuth: () => true,
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "token" }),
      };
    },
    ui: {
      setWidget: () => {},
      setStatus: () => {},
      theme: { fg: (_color: string, text: string) => text },
    },
    invalidate() {
      active = false;
    },
    get staleAccesses() {
      return staleAccesses;
    },
  };

  return context;
}

test("does not access a replaced session context after an in-flight refresh", async () => {
  const response = deferred<Response>();
  let fetchStarted!: () => void;
  const fetchReady = new Promise<void>((resolve) => {
    fetchStarted = resolve;
  });
  const originalFetch = globalThis.fetch;
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);

  globalThis.fetch = async () => {
    fetchStarted();
    return response.promise;
  };
  process.on("unhandledRejection", onUnhandledRejection);

  try {
    const handlers = new Map<
      string,
      (event: unknown, context: ReturnType<typeof createContext>) => void
    >();
    const pi = {
      on(
        event: string,
        handler: (event: unknown, context: ReturnType<typeof createContext>) => void,
      ) {
        handlers.set(event, handler);
      },
      registerCommand() {},
      exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    };
    const context = createContext();

    extension(pi as unknown as ExtensionAPI);
    handlers.get("session_start")?.({}, context);
    await fetchReady;

    context.invalidate();
    handlers.get("session_shutdown")?.({}, context);
    response.resolve({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 5 * 60 * 60,
          },
        },
      }),
    } as Response);

    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(context.staleAccesses, 0);
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
    globalThis.fetch = originalFetch;
  }
});
