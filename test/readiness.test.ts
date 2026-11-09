import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadinessMonitor } from "../src/readiness.js";

describe("createReadinessMonitor", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  let infos: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    infos = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
    infos.mockRestore();
  });

  it("is not ready until the first successful check", async () => {
    const monitor = createReadinessMonitor(async () => true);
    expect(monitor.isReady()).toBe(false);
    await monitor.check();
    expect(monitor.isReady()).toBe(true);
  });

  it("rides out a single failure and goes unready once the last success is stale", async () => {
    let now = 0;
    let healthy = true;
    const monitor = createReadinessMonitor(async () => healthy, { staleAfterMs: 20_000, now: () => now });
    await monitor.check();
    healthy = false;
    now = 5_000;
    await monitor.check();
    expect(monitor.isReady()).toBe(true);
    now = 20_000;
    await monitor.check();
    expect(monitor.isReady()).toBe(false);
  });

  it("treats a slow ping as a failure", async () => {
    const monitor = createReadinessMonitor(() => new Promise<boolean>(() => {}), { timeoutMs: 10 });
    await monitor.check();
    expect(monitor.isReady()).toBe(false);
    expect(String(errors.mock.calls[0]?.[1])).toContain("timed out after 10 ms");
  });

  it("logs why it fails once per change, and the recovery once", async () => {
    const error = Object.assign(new Error("security_exception: unable to authenticate"), { meta: { statusCode: 401 } });
    let healthy = false;
    const monitor = createReadinessMonitor(async () => {
      if (!healthy) throw error;
      return true;
    });
    for (let i = 0; i < 3; i++) await monitor.check();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith("readiness: Elasticsearch unreachable", error);
    healthy = true;
    await monitor.check();
    await monitor.check();
    expect(infos).toHaveBeenCalledTimes(1);
    expect(infos).toHaveBeenCalledWith("readiness: Elasticsearch reachable");
  });

  it("doesn't start a new ping while a timed-out one is still running", async () => {
    let resolve!: (value: boolean) => void;
    const ping = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const monitor = createReadinessMonitor(ping, { timeoutMs: 10 });
    await monitor.check();
    await monitor.check();
    expect(ping).toHaveBeenCalledTimes(1);
    resolve(true);
    await new Promise((r) => setTimeout(r, 0));
    await monitor.check();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("never runs two checks at once", async () => {
    let resolve!: (value: boolean) => void;
    const ping = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const monitor = createReadinessMonitor(ping);
    const first = monitor.check();
    await monitor.check();
    expect(ping).toHaveBeenCalledTimes(1);
    resolve(true);
    await first;
    expect(monitor.isReady()).toBe(true);
  });
});
