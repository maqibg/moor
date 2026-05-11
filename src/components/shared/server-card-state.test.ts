import { describe, expect, it } from "vite-plus/test";
import { getRemoveFeedback } from "./server-card-state";

describe("server card remove feedback", () => {
  it("returns confirmation, pending, and error copy for remove states", () => {
    expect(
      getRemoveFeedback({
        serverName: "context7",
        confirmingRemove: true,
        isRemoving: false,
        removeError: null,
      }),
    ).toEqual({
      kind: "confirm",
      message: 'Remove "context7"? This cannot be undone.',
    });

    expect(
      getRemoveFeedback({
        serverName: "context7",
        confirmingRemove: true,
        isRemoving: true,
        removeError: null,
      }),
    ).toEqual({
      kind: "removing",
      message: "Removing context7...",
    });

    expect(
      getRemoveFeedback({
        serverName: "context7",
        confirmingRemove: false,
        isRemoving: false,
        removeError: "Foreign key constraint failed",
      }),
    ).toEqual({
      kind: "error",
      message: "Foreign key constraint failed",
    });
  });
});
