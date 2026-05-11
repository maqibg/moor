import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ErrorBoundary } from "./ErrorBoundary";

type TestElement = ReactElement<{ children?: unknown; onClick?: () => void }>;

const originalWindow = globalThis.window;

function findElementByText(node: unknown, text: string): TestElement | null {
  if (!isValidElement(node)) return null;
  const element = node as TestElement;
  if (element.props.children === text) return element;
  const children = Array.isArray(element.props.children)
    ? element.props.children
    : [element.props.children];

  for (const child of children) {
    const found = findElementByText(child, text);
    if (found) return found;
  }
  return null;
}

describe("ErrorBoundary", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("resets the boundary from its primary recovery action", () => {
    const boundary = new ErrorBoundary({ children: "content" });
    boundary.state = { hasError: true, error: new Error("boom") };
    const setState = vi.spyOn(boundary, "setState");

    const button = findElementByText(boundary.render(), "Try again");

    expect(button).not.toBeNull();
    button?.props.onClick?.();
    expect(setState).toHaveBeenCalledWith({ hasError: false, error: null });
  });

  it("renders a home navigation recovery action", () => {
    const boundary = new ErrorBoundary({ children: "content" });
    boundary.state = { hasError: true, error: new Error("boom") };

    expect(findElementByText(boundary.render(), "Back to home")).not.toBeNull();
  });
});
