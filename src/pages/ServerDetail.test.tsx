import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";

const testState = vi.hoisted(() => ({
  forceEdit: false,
  useStateCalls: 0,
  editForm: {
    name: "Create Tools",
    command: "node",
    url: "",
    args: "server.js",
    env: [] as Array<[string, string]>,
    headers: [] as Array<[string, string]>,
    workingDir: "/tmp/project",
  },
  server: {
    id: "server-a",
    name: "Create Tools",
    connectionType: "stdio",
    status: "running",
    autoStart: false,
    command: "node",
    args: ["server.js"],
    url: null,
    env: {},
    headers: null,
    workingDir: "/tmp/project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    runtime: {
      id: "server-a",
      name: "Create Tools",
      connectionType: "stdio",
      status: "running",
      autoStart: false,
    },
  } as import("@moor/types").ServerDetail,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      if (!testState.forceEdit) return actual.useState(initial);
      testState.useStateCalls += 1;
      if (testState.useStateCalls === 1) {
        return [true, () => undefined] as unknown as ReturnType<typeof actual.useState<T>>;
      }
      if (testState.useStateCalls === 2) {
        return [testState.editForm, () => undefined] as unknown as ReturnType<
          typeof actual.useState<T>
        >;
      }
      if (testState.useStateCalls === 3) {
        return [false, () => undefined] as unknown as ReturnType<typeof actual.useState<T>>;
      }
      return actual.useState(initial);
    },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => () => undefined,
  useParams: () => ({ id: "server-a" }),
  useBlocker: () => ({ state: "unblocked" }),
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
    server: testState.server,
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
  beforeEach(() => {
    testState.forceEdit = false;
    testState.useStateCalls = 0;
    testState.editForm = {
      name: "Create Tools",
      command: "node",
      url: "",
      args: "server.js",
      env: [],
      headers: [],
      workingDir: "/tmp/project",
    };
    testState.server = {
      id: "server-a",
      name: "Create Tools",
      connectionType: "stdio",
      status: "running",
      autoStart: false,
      command: "node",
      args: ["server.js"],
      url: null,
      env: {},
      headers: null,
      workingDir: "/tmp/project",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      runtime: {
        id: "server-a",
        name: "Create Tools",
        connectionType: "stdio",
        status: "running",
        autoStart: false,
      },
    } as import("@moor/types").ServerDetail;
  });

  it("classifies tools from the original tool name", () => {
    const markup = renderToStaticMarkup(<ServerDetail />);

    expect(markup).toContain(">Search<");
    expect(markup).not.toContain("bg-edit/15");
  });

  it("keeps working directory editable for stdio servers", () => {
    testState.forceEdit = true;

    const markup = renderToStaticMarkup(<ServerDetail />);

    expect(markup).toContain(">Working Directory<");
  });

  it("hides working directory editing for HTTP servers", () => {
    testState.forceEdit = true;
    testState.editForm = {
      name: "Docs API",
      command: "",
      url: "http://localhost:3000/mcp",
      args: "",
      env: [],
      headers: [],
      workingDir: "/tmp/project",
    };
    testState.server = {
      ...testState.server,
      name: "Docs API",
      connectionType: "http",
      status: "stopped",
      command: null,
      args: null,
      url: "http://localhost:3000/mcp",
      workingDir: "/tmp/project",
      runtime: {
        id: "server-a",
        name: "Docs API",
        connectionType: "http",
        status: "stopped",
        autoStart: false,
      },
    };

    const markup = renderToStaticMarkup(<ServerDetail />);

    expect(markup).toContain(">URL<");
    expect(markup).not.toContain(">Working Directory<");
  });
});
