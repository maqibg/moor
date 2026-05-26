import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { SSEProvider } from "@/contexts/SSEContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { applyCachedTheme } from "@/hooks/useTheme";
import App from "./App";
import "./styles/globals.css";

applyCachedTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SSEProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </SSEProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
