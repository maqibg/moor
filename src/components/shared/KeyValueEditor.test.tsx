import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import { KeyValueEditor } from "./KeyValueEditor";
import { findDuplicateHeaderKeys } from "@/lib/server-form";

describe("KeyValueEditor", () => {
  it("connects duplicated key inputs to the duplicate-key error message", () => {
    const markup = renderToStaticMarkup(
      <KeyValueEditor
        entries={[
          [" Authorization ", "Bearer a"],
          ["authorization", "Bearer b"],
        ]}
        onChange={() => undefined}
        duplicateKeyFinder={findDuplicateHeaderKeys}
        keyLabel="Header"
      />,
    );

    const errorId = markup.match(/<p id="([^"]+)"[^>]*>Header keys must be unique\./)?.[1];

    expect(errorId).toBeTruthy();
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(`aria-describedby="${errorId}"`);
  });
});
