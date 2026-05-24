import { describe, expect, it } from "vite-plus/test";
import {
  argsToArrayOrNull,
  argsToArrayOrUndefined,
  entriesToRecordOrNull,
  entriesToRecordOrUndefined,
  findDuplicateKeys,
} from "./server-form";

describe("server form utilities", () => {
  it("uses undefined for empty create fields and null for empty update fields", () => {
    expect(entriesToRecordOrUndefined([["", "ignored"]])).toBeUndefined();
    expect(entriesToRecordOrNull([["", "ignored"]])).toBeNull();
    expect(argsToArrayOrUndefined(" \n ")).toBeUndefined();
    expect(argsToArrayOrNull(" \n ")).toBeNull();
  });

  it("trims keys and argument lines while preserving values", () => {
    expect(
      entriesToRecordOrUndefined([
        [" TOKEN ", " secret "],
        ["EMPTY", ""],
      ]),
    ).toEqual({ TOKEN: " secret ", EMPTY: "" });
    expect(argsToArrayOrUndefined(" one \n\n two ")).toEqual(["one", "two"]);
  });

  it("reports every row that participates in a duplicate trimmed key", () => {
    expect(
      Array.from(
        findDuplicateKeys([
          [" TOKEN ", "a"],
          ["TOKEN", "b"],
          ["OTHER", "c"],
        ]),
      ),
    ).toEqual([0, 1]);
  });
});
