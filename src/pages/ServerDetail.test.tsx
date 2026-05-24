import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerEditFields, ToolCategoryBadge, type EditForm } from "./ServerDetail";

const baseForm: EditForm = {
  name: "Create Tools",
  command: "node",
  url: "",
  args: "server.js",
  env: [],
  headers: [],
  workingDir: "/tmp/project",
};

describe("ServerDetail", () => {
  it("classifies tools from the original tool name", () => {
    const markup = renderToStaticMarkup(<ToolCategoryBadge name="search" />);

    expect(markup).toContain(">Search<");
    expect(markup).toContain("bg-grep/15");
    expect(markup).not.toContain("bg-edit/15");
  });

  it("keeps working directory editable for stdio servers", () => {
    const markup = renderToStaticMarkup(
      <ServerEditFields form={baseForm} connectionType="stdio" onChange={() => undefined} />,
    );

    expect(markup).toContain(">Working Directory<");
    expect(markup).toContain("Type cannot be changed after creation.");
  });

  it("hides working directory editing for HTTP servers", () => {
    const markup = renderToStaticMarkup(
      <ServerEditFields
        form={{ ...baseForm, command: "", url: "http://localhost:3000/mcp" }}
        connectionType="http"
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain(">URL<");
    expect(markup).not.toContain(">Working Directory<");
  });
});
