/** Static model downloads only: never forwards user input or inference requests. */
export function createModelDownloadFetch(
  fetcher: typeof fetch,
  pinned: Record<string, string> = {},
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    if (
      url.origin !== "https://huggingface.co" ||
      method !== "GET" ||
      !/^\/[^/]+\/[^/]+\/resolve\//.test(url.pathname)
    )
      return fetcher(input, init);
    const parts = url.pathname.split("/"),
      model = parts[1] + "/" + parts[2];
    // Transformers.js probes tokenizer metadata at `main` even when a revision was supplied.
    if (parts[4] === "main" && pinned[model]) {
      parts[4] = pinned[model];
      url.pathname = parts.join("/");
    }
    if (typeof caches !== "undefined") {
      try {
        const cached = await (
          await caches.open("transformers-cache")
        ).match(url.href);
        if (cached) return cached;
      } catch {
        /* Cache unavailable: use bounded network recovery. */
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (init?.signal?.aborted) throw init.signal.reason;
      const target = new URL(url);
      if (attempt)
        target.searchParams.set("aftertrace_retry", crypto.randomUUID());
      try {
        const response = await fetcher(target.href, {
          ...init,
          credentials: "omit",
          mode: "cors",
          referrerPolicy: "no-referrer",
        });
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          await response.body?.cancel();
          continue;
        }
        return response;
      } catch (error) {
        if (init?.signal?.aborted) throw error;
        if (!(error instanceof TypeError)) throw error;
        if (attempt === 2)
          throw new Error(
            "模型資源下載失敗（網路或跨來源限制）。請稍後按 AI 解析重試；原有內容仍保留，也可手動保存。",
          );
      }
    }
    throw new Error("模型資源下載失敗。");
  };
}
