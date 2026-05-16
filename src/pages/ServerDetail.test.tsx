import { describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react-router-dom", () => ({
  useNavigate: () => () => undefined,
  useParams: () => ({ id: "server-a" }),
}));

vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: () => ({
    profiles: [{ id: "profile-a", isActive: true }],
    updateProfileServer: vi.fn(),
  }),
}));

vi.mock("@/hooks/useServers", () => ({
  useServerActions: () => ({
    startServer: vi.fn(),
    stopServer: vi.fn(),
    updateServer: vi.fn(),
  }),
  useServer: () => ({
    server: {
      id: "server-a",
      name: "Create Tools",
      connectionType: "stdio",
      status: "running",
      autoStart: false,
    },
    isLoading: false,
  }),
  useServerTools: () => ({
    tools: [
      {
        toolName: "search",
        exposedName: "create_tools__search",
        disabled: false,
      },
    ],
    refresh: vi.fn(),
  }),
}));

import { ServerDetail } from "./ServerDetail";

describe("ServerDetail", () => {
  it("classifies tools from the original tool name", () => {
    const markup = renderToStaticMarkup(<ServerDetail />);

    expect(markup).toContain(">Search<");
    expect(markup).not.toContain(">Edit<");
  });
});
