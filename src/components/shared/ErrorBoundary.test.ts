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

  it("reloads the page from its recovery action", () => {
    const reload = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { reload } },
    });
    const boundary = new ErrorBoundary({ children: "content" });
    boundary.state = { hasError: true, error: new Error("boom") };

    const button = findElementByText(boundary.render(), "Reload page");

    expect(button).not.toBeNull();
    button?.props.onClick?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
