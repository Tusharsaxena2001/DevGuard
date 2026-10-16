import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { admin, employee, metrics } from "./data.js";
import { fakeNetwork, renderApp } from "./helpers.js";

const overview = { "GET /v1/metrics/summary": { body: metrics() } };

describe("session and role-aware routing", () => {
  it("sends a signed-out visitor to the login page", async () => {
    const net = fakeNetwork({ "GET /v1/auth/me": { status: 401, body: { code: "unauthenticated", message: "Authentication is required." } } });
    renderApp("/events", net);
    expect(await screen.findByRole("heading", { name: "DevGuard" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(net.calledWith("GET", "/v1/events")).toHaveLength(0);
  });

  it("shows a loading state while the session is being checked", () => {
    const net = fakeNetwork({ "GET /v1/auth/me": () => new Promise(() => undefined) });
    renderApp("/", net);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
  });

  it("shows an actionable error, with retry, when the server cannot be reached", async () => {
    const net = fakeNetwork({ "GET /v1/auth/me": { status: 500, body: { code: "internal_error", message: "An internal error occurred." } } });
    renderApp("/", net);
    expect(await screen.findByRole("alert")).toHaveTextContent("An internal error occurred.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("lets an administrator in and shows the navigation", async () => {
    renderApp("/", fakeNetwork({ "GET /v1/auth/me": { body: admin }, ...overview }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    const nav = within(screen.getByRole("navigation", { name: "Main" }));
    for (const name of ["Overview", "Events", "Approvals", "Projects", "Devices", "Audit"]) expect(nav.getByRole("link", { name })).toBeInTheDocument();
  });

  it("tells a signed-in employee the dashboard is for administrators, and makes no admin calls", async () => {
    const net = fakeNetwork({ "GET /v1/auth/me": { body: employee } });
    renderApp("/audit", net);
    expect(await screen.findByRole("heading", { name: /for security administrators/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(net.calledWith("GET", "/v1/audit")).toHaveLength(0);
  });

  it("lets a signed-in employee sign out from the administrators-only page", async () => {
    let signedIn = true;
    const net = fakeNetwork({
      "GET /v1/auth/me": () => (signedIn ? { body: employee } : { status: 401, body: { code: "unauthenticated", message: "x" } }),
      "POST /v1/auth/logout": () => ((signedIn = false), { status: 204 }),
    });
    renderApp("/", net);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "DevGuard" })).toBeInTheDocument();
    expect(net.calledWith("POST", "/v1/auth/logout")).toHaveLength(1);
  });

  it("when the server answers 403 to an admin screen the page says so instead of crashing", async () => {
    const net = fakeNetwork({ "GET /v1/auth/me": { body: admin }, "GET /v1/audit": { status: 403, body: { code: "forbidden", message: "You do not have permission to do this." } } });
    renderApp("/audit", net);
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to do that.");
  });

  it("signs in, then lands on the overview", async () => {
    let signedIn = false;
    const net = fakeNetwork({
      "GET /v1/auth/me": () => (signedIn ? { body: admin } : { status: 401, body: { code: "unauthenticated", message: "x" } }),
      "POST /v1/auth/login": () => ((signedIn = true), { body: admin }),
      ...overview,
    });
    renderApp("/login", net);
    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "a-long-synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(net.calledWith("POST", "/v1/auth/login")[0]?.body).toEqual({ email: "admin@example.test", password: "a-long-synthetic-password" });
  });

  it("says 'invalid email or password' without revealing which was wrong", async () => {
    const net = fakeNetwork({
      "GET /v1/auth/me": { status: 401, body: { code: "unauthenticated", message: "x" } },
      "POST /v1/auth/login": { status: 401, body: { code: "unauthenticated", message: "Invalid email or password." } },
    });
    renderApp("/login", net);
    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-wrong-wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
  });

  it("signing out returns to the login page", async () => {
    let signedIn = true;
    const net = fakeNetwork({
      "GET /v1/auth/me": () => (signedIn ? { body: admin } : { status: 401, body: { code: "unauthenticated", message: "x" } }),
      "POST /v1/auth/logout": () => ((signedIn = false), { status: 204 }),
      ...overview,
    });
    renderApp("/", net);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    await waitFor(() => expect(net.calledWith("POST", "/v1/auth/logout")).toHaveLength(1));
  });

  it("an unknown page inside the app says so", async () => {
    renderApp("/nowhere", fakeNetwork({ "GET /v1/auth/me": { body: admin } }));
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
  });
});

describe("a session that ends while the page is open", () => {
  it("sends the person to the login page when the server says 401 to an action, instead of showing a dead screen", async () => {
    let signedIn = true;
    const net = fakeNetwork({
      "GET /v1/auth/me": () => (signedIn ? { body: admin } : { status: 401, body: { code: "unauthenticated", message: "x" } }),
      "GET /v1/projects": { body: [] },
      "POST /v1/projects": () => ((signedIn = false), { status: 401, body: { code: "unauthenticated", message: "Authentication is required." } }),
    });
    renderApp("/projects", net);
    await userEvent.type(await screen.findByLabelText("New project name"), "Payments");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("a wrong password on the login form is not mistaken for an expired session", async () => {
    const net = fakeNetwork({
      "GET /v1/auth/me": { status: 401, body: { code: "unauthenticated", message: "x" } },
      "POST /v1/auth/login": { status: 401, body: { code: "unauthenticated", message: "Invalid email or password." } },
    });
    renderApp("/login", net);
    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-wrong-wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("does not show the previous person's cached data to whoever signs in next on the same tab", async () => {
    let user: typeof admin | null = admin;
    const second = { ...admin, id: "00000000-0000-4000-8000-0000000000a2", name: "Second Admin" };
    const net = fakeNetwork({
      "GET /v1/auth/me": () => (user === null ? { status: 401, body: { code: "unauthenticated", message: "x" } } : { body: user }),
      "GET /v1/projects": () => ({ body: user?.id === admin.id ? [{ id: "00000000-0000-4000-8000-0000000000c1", name: "First Admins Secret Project", classification: "internal", ownerId: admin.id, createdAt: "2026-06-01T12:00:00.000Z", memberIds: [] }] : [] }),
      "POST /v1/auth/logout": () => ((user = null), { status: 204 }),
      "POST /v1/auth/login": () => ((user = second), { body: second }),
    });
    renderApp("/projects", net);
    expect(await screen.findByRole("link", { name: "First Admins Secret Project" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await userEvent.type(await screen.findByLabelText("Email"), "second@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "a-long-synthetic-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.queryByText("First Admins Secret Project")).not.toBeInTheDocument();
  });
});
