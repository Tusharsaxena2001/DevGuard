import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { useSession } from "../features/auth/api/session.js";
import { LoginPage } from "../features/auth/pages/LoginPage.js";
import { ApprovalsPage } from "../features/approvals/pages/ApprovalsPage.js";
import { AuditPage } from "../features/audit/pages/AuditPage.js";
import { DevicesPage } from "../features/devices/pages/DevicesPage.js";
import { EventsPage } from "../features/events/pages/EventsPage.js";
import { OverviewPage } from "../features/overview/pages/OverviewPage.js";
import { ProjectPage } from "../features/projects/pages/ProjectPage.js";
import { ProjectsPage } from "../features/projects/pages/ProjectsPage.js";
import { EmptyState } from "../shared/ui/States.js";
import { RequireAdmin } from "./RequireAdmin.js";

function Approvals(): ReactNode {
  const me = useSession().data?.id ?? "";
  return <ApprovalsPage me={me} />;
}

export function App(): ReactNode {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAdmin />}>
        <Route index element={<OverviewPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<ProjectPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<EmptyState title="Page not found" hint="Use the menu to go somewhere that exists." />} />
      </Route>
    </Routes>
  );
}
