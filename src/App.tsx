import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { PageLoading } from "@/components/shared/PageLoading";

const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((module) => ({ default: module.Dashboard })),
);
const Servers = lazy(() =>
  import("@/pages/Servers").then((module) => ({ default: module.Servers })),
);
const ServerDetail = lazy(() =>
  import("@/pages/ServerDetail").then((module) => ({ default: module.ServerDetail })),
);
const Profiles = lazy(() =>
  import("@/pages/Profiles").then((module) => ({ default: module.Profiles })),
);
const ProfileDetail = lazy(() =>
  import("@/pages/ProfileDetail").then((module) => ({ default: module.ProfileDetail })),
);
const AuditLogs = lazy(() =>
  import("@/pages/AuditLogs").then((module) => ({ default: module.AuditLogs })),
);
const ClientConfig = lazy(() =>
  import("@/pages/ClientConfig").then((module) => ({ default: module.ClientConfig })),
);
const SettingsPage = lazy(() =>
  import("@/pages/Settings").then((module) => ({ default: module.SettingsPage })),
);
const NotFound = lazy(() =>
  import("@/pages/NotFound").then((module) => ({ default: module.NotFound })),
);

function page(element: ReactNode) {
  return <Suspense fallback={<PageLoading message="Loading page..." />}>{element}</Suspense>;
}

function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={page(<Dashboard />)} />
            <Route path="/servers" element={page(<Servers />)} />
            <Route path="/servers/:id" element={page(<ServerDetail />)} />
            <Route path="/profiles" element={page(<Profiles />)} />
            <Route path="/profiles/:id" element={page(<ProfileDetail />)} />
            <Route path="/logs" element={page(<AuditLogs />)} />
            <Route path="/config" element={page(<ClientConfig />)} />
            <Route path="/settings" element={page(<SettingsPage />)} />
            <Route path="*" element={page(<NotFound />)} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
