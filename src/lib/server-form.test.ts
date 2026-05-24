import { describe, expect, it } from "vite-plus/test";
import {
  argsToArrayOrNull,
  argsToArrayOrUndefined,
  entriesToRecordOrNull,
  entriesToRecordOrUndefined,
  findDuplicateHeaderKeys,
  findDuplicateKeys,
  headerEntriesToRecordOrNull,
  headerEntriesToRecordOrUndefined,
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

  it("parses pasted argument lines with Windows line endings", () => {
    expect(argsToArrayOrUndefined(" one\r\n\r\n two ")).toEqual(["one", "two"]);
  });

  it("normalizes HTTP header keys before creating payload records", () => {
    expect(
      headerEntriesToRecordOrUndefined([
        [" Authorization ", "Bearer token"],
        ["X-Trace", "abc"],
      ]),
    ).toEqual({ authorization: "Bearer token", "x-trace": "abc" });
    expect(headerEntriesToRecordOrNull([["", "ignored"]])).toBeNull();
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

  it("keeps environment keys case-sensitive but reports duplicate HTTP headers case-insensitively", () => {
    expect(
      Array.from(
        findDuplicateKeys([
          ["TOKEN", "a"],
          ["token", "b"],
        ]),
      ),
    ).toEqual([]);
    expect(
      Array.from(
        findDuplicateHeaderKeys([
          [" Authorization ", "Bearer a"],
          ["authorization", "Bearer b"],
          ["X-Other", "c"],
        ]),
      ),
    ).toEqual([0, 1]);
  });
});
