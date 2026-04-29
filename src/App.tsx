import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Dashboard } from "@/pages/Dashboard";
import { Servers } from "@/pages/Servers";
import { ServerDetail } from "@/pages/ServerDetail";
import { Profiles } from "@/pages/Profiles";
import { ProfileDetail } from "@/pages/ProfileDetail";
import { ClientConfig } from "@/pages/ClientConfig";
import { AuditLogs } from "@/pages/AuditLogs";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/servers" element={<Servers />} />
          <Route path="/servers/:id" element={<ServerDetail />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/profiles/:id" element={<ProfileDetail />} />
          <Route path="/logs" element={<AuditLogs />} />
          <Route path="/config" element={<ClientConfig />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
