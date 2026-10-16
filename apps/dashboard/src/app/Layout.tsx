import type { SessionUser } from "@devguard/shared";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useLogout } from "../features/auth/api/session.js";
import { Button } from "../shared/ui/Button.js";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/events", label: "Events" },
  { to: "/approvals", label: "Approvals" },
  { to: "/projects", label: "Projects" },
  { to: "/devices", label: "Devices" },
  { to: "/audit", label: "Audit" },
] as const;

export function Layout({ user, children }: { user: SessionUser; children: ReactNode }): ReactNode {
  const logout = useLogout();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white p-4 md:w-56 md:border-b-0 md:border-r">
        <p className="mb-4 text-lg font-semibold">DevGuard</p>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item}
              className={({ isActive }) => `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 text-xs text-slate-500">
          <p>{user.name}</p>
          <Button variant="secondary" className="mt-2" onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
