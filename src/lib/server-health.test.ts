import { describe, expect, it } from "vite-plus/test";
import type { ServerHealth } from "@moor/types";
import {
  findServerHealth,
  formatHealthFailureSummary,
  healthBadgeVariant,
  healthCheckErrorKey,
  healthStatusLabel,
  isHealthFailure,
  mergeServerHealthSnapshot,
  parseHealthIntervalSecondsInput,
} from "./server-health";

function snapshot(serverId: string, status: ServerHealth["status"] = "healthy"): ServerHealth {
  return {
    serverId,
    status,
    checkedAt: "2026-01-01T00:00:00Z",
    consecutiveFailures: 0,
    errorMessage: null,
  };
}

describe("health interval input", () => {
  it("accepts only whole seconds inside the sidecar range", () => {
    expect(parseHealthIntervalSecondsInput("30")).toEqual({ valid: true, seconds: 30 });
    expect(parseHealthIntervalSecondsInput("600")).toEqual({ valid: true, seconds: 600 });
    expect(parseHealthIntervalSecondsInput(" 60 ")).toEqual({ valid: true, seconds: 60 });
  });

  it("rejects empty, fractional and out-of-range values with a visible message", () => {
    const message = "Enter a whole number between 30 and 600.";
    expect(parseHealthIntervalSecondsInput("")).toEqual({ valid: false, message });
    expect(parseHealthIntervalSecondsInput("29")).toEqual({ valid: false, message });
    expect(parseHealthIntervalSecondsInput("601")).toEqual({ valid: false, message });
    expect(parseHealthIntervalSecondsInput("60.5")).toEqual({ valid: false, message });
    expect(parseHealthIntervalSecondsInput("abc")).toEqual({ valid: false, message });
  });
});

describe("health snapshot merging", () => {
  it("replaces a snapshot in place so list order stays stable", () => {
    const merged = mergeServerHealthSnapshot([snapshot("a"), snapshot("b"), snapshot("c")], {
      ...snapshot("b", "unhealthy"),
      consecutiveFailures: 3,
      errorMessage: "boom",
    });

    expect(merged.map((item) => item.serverId)).toEqual(["a", "b", "c"]);
    expect(merged[1].status).toBe("unhealthy");
    expect(merged[1].consecutiveFailures).toBe(3);
    expect(merged[1].errorMessage).toBe("boom");
  });

  it("appends unknown servers and seeds an empty cache", () => {
    expect(mergeServerHealthSnapshot(undefined, snapshot("a"))).toEqual([snapshot("a")]);
    expect(mergeServerHealthSnapshot([snapshot("a")], snapshot("b"))).toEqual([
      snapshot("a"),
      snapshot("b"),
    ]);
  });

  it("looks a snapshot up by server id and tolerates a missing id", () => {
    expect(findServerHealth([snapshot("a"), snapshot("b")], "b")?.serverId).toBe("b");
    expect(findServerHealth([snapshot("a")], "missing")).toBeUndefined();
    expect(findServerHealth([snapshot("a")], undefined)).toBeUndefined();
  });
});

describe("health status presentation", () => {
  it("maps every status to a distinct label and badge variant", () => {
    expect(healthStatusLabel("unknown")).toBe("Not checked");
    expect(healthStatusLabel("healthy")).toBe("Healthy");
    expect(healthStatusLabel("unhealthy")).toBe("Health check failed");
    expect(healthStatusLabel("unsupported")).toBe("Health checks unsupported");

    expect(healthBadgeVariant("healthy")).toBe("success");
    expect(healthBadgeVariant("unhealthy")).toBe("error");
    expect(healthBadgeVariant("unknown")).toBe("subtle");
    expect(healthBadgeVariant("unsupported")).toBe("subtle");
  });

  it("treats only unhealthy as a failure", () => {
    expect(isHealthFailure("unhealthy")).toBe(true);
    expect(isHealthFailure("unknown")).toBe(false);
    expect(isHealthFailure("unsupported")).toBe(false);
    expect(isHealthFailure("healthy")).toBe(false);
  });

  it("summarizes failures with the redacted backend error message", () => {
    const t = (key: string, vars?: Record<string, string>) =>
      vars ? key.replace("{{count}}", vars.count) : key;

    expect(
      formatHealthFailureSummary(
        { ...snapshot("a", "unhealthy"), consecutiveFailures: 3, errorMessage: "ping failed" },
        t,
      ),
    ).toBe("3 consecutive failures · ping failed");

    expect(
      formatHealthFailureSummary(
        { ...snapshot("a", "unhealthy"), consecutiveFailures: 2, errorMessage: null },
        t,
      ),
    ).toBe("2 consecutive failures");
  });
});

describe("health check errors", () => {
  it("explains the sidecar 404/409 conflicts", () => {
    expect(healthCheckErrorKey("Server not found")).toBe(
      "This server no longer exists. Refresh the server list.",
    );
    expect(healthCheckErrorKey("Server is not running")).toBe(
      "The server is not running. Start it before checking health.",
    );
    expect(healthCheckErrorKey("Server session changed during the health check")).toBe(
      "The server restarted during the health check. Try again.",
    );
  });

  it("passes unknown errors through instead of hiding them", () => {
    expect(healthCheckErrorKey("Unable to connect to the Moor sidecar")).toBe(
      "Unable to connect to the Moor sidecar",
    );
  });
});
