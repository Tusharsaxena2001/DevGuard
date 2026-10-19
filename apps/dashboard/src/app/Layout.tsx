import type { SessionUser } from "@devguard/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useLogout } from "../features/auth/api/session.js";
import { useIsDesktop } from "../shared/lib/useMediaQuery.js";
import { Button } from "../shared/ui/Button.js";
import { ThemeToggle } from "../shared/ui/ThemeToggle.js";
import { useFocusTrap } from "../shared/ui/useFocusTrap.js";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/events", label: "Events" },
  { to: "/approvals", label: "Approvals" },
  { to: "/projects", label: "Projects" },
  { to: "/devices", label: "Devices" },
  { to: "/audit", label: "Audit" },
] as const;

const sectionOf = (pathname: string): string | undefined =>
  NAV.find((item) => ("end" in item ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)))?.label;

/**
 * App shell. From `lg` (1024px) up: a sticky sidebar. Below: a top bar with a menu button that opens the navigation as a drawer
 * (focus is trapped inside it, Escape or a tap outside closes it). Also: a skip link, a title per page, and focus moved to the
 * page heading after navigation so keyboard and screen-reader users are not left on the old page.
 */
export function Layout({ user, children }: { user: SessionUser; children: ReactNode }): ReactNode {
  const logout = useLogout();
  const desktop = useIsDesktop();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const drawerOpen = open && !desktop;
  const section = sectionOf(pathname);

  useFocusTrap(drawer, drawerOpen, () => setOpen(false));

  useEffect(() => {
    document.title = `${section ?? "Page not found"} - DevGuard`;
    setOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const target = main.current?.querySelector<HTMLElement>("h1") ?? main.current;
    target?.focus();
  }, [pathname, section]);

  const skip = (event: { preventDefault: () => void }): void => {
    event.preventDefault();
    main.current?.focus();
  };

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" onClick={skip} className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:ring-2 focus:ring-slate-900">
        Skip to content
      </a>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
        <Button variant="secondary" aria-expanded={drawerOpen} aria-controls="primary-nav" aria-label={drawerOpen ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          Menu
        </Button>
        <p className="min-w-0 flex-1 truncate font-semibold">DevGuard</p>
        {section === undefined ? null : <p className="text-sm text-slate-500">{section}</p>}
      </header>

      {drawerOpen ? <button type="button" tabIndex={-1} aria-label="Close menu" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} /> : null}

      <aside
        ref={drawer}
        id="primary-nav"
        inert={!desktop && !open}
        className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-slate-200 bg-white p-4 pt-[max(1rem,env(safe-area-inset-top))] transition-transform motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:self-start ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <p className="mb-4 text-lg font-semibold">DevGuard</p>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item}
              className={({ isActive }) => `flex min-h-11 items-center rounded-md px-3 py-2 text-sm lg:min-h-9 lg:py-1.5 ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 pt-6 text-xs text-slate-500">
          <p className="break-words">{user.name}</p>
          <ThemeToggle className="w-full" />
          <Button variant="secondary" className="w-full" onClick={() => logout.mutate()}>
            Sign out
          </Button>
        </div>
      </aside>

      <main id="main" ref={main} tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none lg:p-8">
        {children}
      </main>
    </div>
  );
}
