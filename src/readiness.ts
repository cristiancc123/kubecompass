import { log } from "./log.js";

/** What /readyz answers from. Never does I/O, so the probe can't time out on a slow dependency. */
export interface Readiness {
  isReady(): boolean;
}

export interface ReadinessMonitor extends Readiness {
  /** Runs one check now. Skipped while an earlier ping, even a timed-out one, is still running. */
  check(): Promise<void>;
  /** Checks immediately and then on the interval. Returns a function that stops it. */
  start(): () => void;
}

export interface ReadinessOptions {
  intervalMs?: number;
  /** A check slower than this counts as a failure. */
  timeoutMs?: number;
  /** Ready while the last successful check is younger than this. */
  staleAfterMs?: number;
  now?: () => number;
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Elasticsearch ping timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Checks Elasticsearch in the background, as Radar's AI investigation
 * recommended, instead of on every readiness probe. A single slow or failed
 * check doesn't take the pod out of service; failures for longer than
 * `staleAfterMs` do. The first failure logs why (a 401 means a wrong API key)
 * and the recovery logs once too.
 */
export function createReadinessMonitor(
  ping: () => Promise<boolean>,
  { intervalMs = 5_000, timeoutMs = 3_000, staleAfterMs = 20_000, now = Date.now }: ReadinessOptions = {},
): ReadinessMonitor {
  let lastSuccessAt: number | undefined;
  let lastCheckOk: boolean | undefined;
  // The ping itself, not the timeout race: a timed-out ping keeps running, and
  // starting another one before it settles would pile up requests on a slow
  // Elasticsearch.
  let pending: Promise<unknown> | undefined;

  async function check(): Promise<void> {
    if (pending) {
      return;
    }
    const attempt = ping();
    pending = attempt.then(
      () => (pending = undefined),
      () => (pending = undefined),
    );
    let failure: unknown;
    try {
      if (!(await withTimeout(attempt, timeoutMs))) {
        failure = new Error("Elasticsearch ping returned false");
      }
    } catch (error) {
      failure = error;
    }
    const ok = failure === undefined;
    if (ok) {
      lastSuccessAt = now();
    }
    if (ok !== lastCheckOk) {
      if (ok) {
        log.info("readiness: Elasticsearch reachable");
      } else {
        const statusCode = (failure as { meta?: { statusCode?: number } }).meta?.statusCode;
        log.error(
          "readiness: Elasticsearch unreachable",
          failure,
          statusCode ? { "http.response.status_code": statusCode } : {},
        );
      }
      lastCheckOk = ok;
    }
  }

  return {
    check,
    isReady: () => lastSuccessAt !== undefined && now() - lastSuccessAt < staleAfterMs,
    start() {
      void check();
      const timer = setInterval(() => void check(), intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}
