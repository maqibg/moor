import { describe, expect, it } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { I18nContext } from "@/contexts/I18nContext";
import { KeyValueEditor } from "./KeyValueEditor";
import { findDuplicateHeaderKeys } from "@/lib/server-form";

function renderWithI18n(children: ReactNode) {
  return renderToStaticMarkup(
    <I18nContext.Provider
      value={{
        language: "en",
        setLanguage: () => undefined,
        t: (key, vars) =>
          Object.entries(vars ?? {}).reduce(
            (text, [name, value]) => text.split(`{{${name}}}`).join(value),
            key,
          ),
      }}
    >
      {children}
    </I18nContext.Provider>,
  );
}

describe("KeyValueEditor", () => {
  it("connects duplicated key inputs to the duplicate-key error message", () => {
    const markup = renderWithI18n(
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
