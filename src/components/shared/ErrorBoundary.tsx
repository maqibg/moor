import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
          <h2 className="font-headline text-xl text-[var(--fg-80)]">Something went wrong</h2>
          <p className="text-sm text-[var(--fg-50)] max-w-md text-center">
            Moor hit an unexpected UI error. Try reloading this view.
          </p>
          <Button onClick={() => this.setState({ hasError: false, error: null })} variant="outline">
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
