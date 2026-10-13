import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nContext } from "@/contexts/I18nContext";
import { serverKeys } from "@/lib/query-keys";
import type { ServerHealth, ServerHealthStatus } from "@moor/types";
import { HealthBadge, ServerHealthPanel } from "./ServerHealth";

function snapshot(status: ServerHealthStatus): ServerHealth {
  return {
    serverId: "server-1",
    status,
    checkedAt: "2026-01-01T00:00:00Z",
    consecutiveFailures: status === "unhealthy" ? 3 : 0,
    errorMessage: status === "unhealthy" ? "ping failed" : null,
  };
}

const translate = (key: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.split(`{{${name}}}`).join(value),
    key,
  );
};

function renderBadge(snapshotValue?: ServerHealth) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <I18nContext.Provider value={{ language: "en", setLanguage: () => undefined, t: translate }}>
        <HealthBadge snapshot={snapshotValue} />
      </I18nContext.Provider>
    </QueryClientProvider>,
  );
}

function renderPanel(running: boolean, status: ServerHealthStatus) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(serverKeys.health(), [snapshot(status)]);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nContext.Provider value={{ language: "en", setLanguage: () => undefined, t: translate }}>
        <ServerHealthPanel serverId="server-1" running={running} />
      </I18nContext.Provider>
    </QueryClientProvider>,
  );
}

/** 「Check now」按钮的开始标签，用于把 disabled 属性断言限定到该按钮
 *  （class 里的 Tailwind 变体 `disabled:opacity-50` 不算属性）。 */
function checkNowButtonOpenTag(markup: string): string | null {
  const match = markup.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Check now/);
  if (!match) return null;
  return match[0].slice(0, match[0].indexOf(">") + 1);
}

const DISABLED_ATTRIBUTE = /\sdisabled(=|"|\s|>)/;

describe("HealthBadge", () => {
  it("renders a distinct label for all four health states", () => {
    expect(renderBadge(snapshot("unknown"))).toContain("Not checked");
    expect(renderBadge(snapshot("healthy"))).toContain("Healthy");
    expect(renderBadge(snapshot("unhealthy"))).toContain("Health check failed");
    expect(renderBadge(snapshot("unsupported"))).toContain("Health checks unsupported");
  });

  it("shows the consecutive failure count and the error summary for unhealthy servers", () => {
    const markup = renderBadge(snapshot("unhealthy"));

    expect(markup).toContain("(3)");
    expect(markup).toContain("3 consecutive failures · ping failed");
  });

  it("falls back to not-checked without a snapshot", () => {
    expect(renderBadge()).toContain("Not checked");
  });
});

describe("ServerHealthPanel", () => {
  it("surfaces failures and the redacted error summary for running servers", () => {
    const markup = renderPanel(true, "unhealthy");

    expect(markup).toContain("Server Health");
    expect(markup).toContain("3 consecutive failures · ping failed");
    // 断言具体到「Check now」按钮本身，避免被页面上其他 disabled 元素干扰。
    const checkNowButton = checkNowButtonOpenTag(markup);
    expect(checkNowButton).not.toBeNull();
    expect(checkNowButton).not.toMatch(DISABLED_ATTRIBUTE);
  });

  it("disables manual checks and hides stale snapshots when the server is stopped", () => {
    const markup = renderPanel(false, "unhealthy");

    expect(markup).toContain("Not checked");
    expect(checkNowButtonOpenTag(markup)).toMatch(DISABLED_ATTRIBUTE);
    expect(markup).not.toContain("ping failed");
  });
});
