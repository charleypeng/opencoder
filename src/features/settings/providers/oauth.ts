// Pure polling helper for the OAuth auto flow (TASK-M5-07): re-runs a
// boolean check every `intervalMs` until it succeeds, the `timeoutMs`
// deadline elapses, or the optional signal aborts (dialog cancel/unmount).
// A rejected check counts as a failed attempt and keeps polling — transient
// network errors must not kill the flow. Resolves true on success, false on
// timeout or abort.

export interface PollUntilOptions {
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export function pollUntil(fn: () => Promise<boolean>, options: PollUntilOptions): Promise<boolean> {
  const { intervalMs, timeoutMs, signal } = options;
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function finish(result: boolean): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    }

    function onAbort(): void {
      finish(false);
    }

    const deadline = Date.now() + timeoutMs;

    async function tick(): Promise<void> {
      if (settled) return;
      let ok = false;
      try {
        ok = await fn();
      } catch {
        ok = false;
      }
      if (settled) return;
      if (ok) {
        finish(true);
        return;
      }
      if (Date.now() >= deadline) {
        finish(false);
        return;
      }
      timer = setTimeout(() => void tick(), intervalMs);
    }

    if (signal?.aborted) {
      finish(false);
      return;
    }
    signal?.addEventListener("abort", onAbort);
    void tick();
  });
}
