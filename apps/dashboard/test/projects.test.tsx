import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ID, admin } from "./data.js";
import { fakeNetwork, renderApp } from "./helpers.js";

const project = { id: ID.project, name: "Payments", classification: "confidential", ownerId: ID.admin, createdAt: "2026-06-01T12:00:00.000Z", memberIds: [ID.alice] };
const users = [
  { id: ID.admin, email: "admin@example.test", name: "Ada Admin", status: "active", isAdmin: true, createdAt: "2026-06-01T12:00:00.000Z" },
  { id: ID.alice, email: "alice@example.test", name: "Alice Employee", status: "active", isAdmin: false, createdAt: "2026-06-01T12:00:00.000Z" },
];
const policy = { version: 3, mode: "enforce", classification: "confidential", destinations: [], prohibitedGlobs: [".env", "*.pem"], secretRules: ["github_token"] };
const dest = { id: ID.event, host: "github.com", repoPath: "acme/portal", type: "exact", createdAt: "2026-06-01T12:00:00.000Z" };
const session = { "GET /v1/auth/me": { body: admin } };
const detail = (extra: Record<string, unknown> = {}) => ({
  ...session,
  [`GET /v1/projects/${ID.project}`]: { body: project },
  "GET /v1/users": { body: users },
  [`GET /v1/projects/${ID.project}/policy`]: { body: policy },
  [`GET /v1/projects/${ID.project}/policy/versions`]: { body: [{ version: 3, mode: "enforce", prohibitedGlobs: [".env"], secretRules: [], createdBy: ID.admin, createdAt: "2026-06-01T12:00:00.000Z" }] },
  [`GET /v1/projects/${ID.project}/destinations`]: { body: [dest] },
  [`GET /v1/projects/${ID.project}/canonical-repos`]: { body: [] },
  [`GET /v1/projects/${ID.project}/fingerprints`]: { body: [] },
  [`GET /v1/projects/${ID.project}/repos`]: { body: [] },
  ...extra,
});

describe("projects list", () => {
  it("shows an empty state that says what to do", async () => {
    renderApp("/projects", fakeNetwork({ ...session, "GET /v1/projects": { body: [] } }));
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("lists projects with a link to each", async () => {
    renderApp("/projects", fakeNetwork({ ...session, "GET /v1/projects": { body: [project] } }));
    expect(await screen.findByRole("link", { name: "Payments" })).toHaveAttribute("href", `/projects/${ID.project}`);
  });

  it("creates a project and refreshes the list", async () => {
    let created = false;
    const net = fakeNetwork({
      ...session,
      "GET /v1/projects": () => ({ body: created ? [project] : [] }),
      "POST /v1/projects": () => ((created = true), { status: 201, body: project }),
    });
    renderApp("/projects", net);
    await userEvent.type(await screen.findByLabelText("New project name"), "Payments");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("link", { name: "Payments" })).toBeInTheDocument();
    expect(net.calledWith("POST", "/v1/projects")[0]?.body).toEqual({ name: "Payments", classification: "confidential" });
  });

  it("shows the server's reason when the name is taken", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/projects": { body: [] }, "POST /v1/projects": { status: 409, body: { code: "conflict", message: "A project with this name already exists." } } });
    renderApp("/projects", net);
    await userEvent.type(await screen.findByLabelText("New project name"), "Payments");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A project with this name already exists.");
  });
});

describe("project detail", () => {
  it("shows people, policy, destinations and detected repositories", async () => {
    renderApp(`/projects/${ID.project}`, fakeNetwork(detail()));
    expect(await screen.findByRole("heading", { name: "Payments" })).toBeInTheDocument();
    const people = await screen.findByRole("region", { name: "People covered" });
    expect(await within(people).findByLabelText(/Alice Employee/)).toBeChecked();
    expect(within(people).getByLabelText(/Ada Admin/)).not.toBeChecked();
    expect(await screen.findByText("Editing version 3. Saving creates version 4; earlier versions stay in the history.")).toBeInTheDocument();
    expect(await screen.findByText("github.com/acme/portal")).toBeInTheDocument();
    expect(await screen.findByText("Detected repositories")).toBeInTheDocument();
  });

  it("saves the people covered", async () => {
    const net = fakeNetwork(detail({ [`PUT /v1/projects/${ID.project}/members`]: { body: { ...project, memberIds: [ID.alice, ID.admin] } } }));
    renderApp(`/projects/${ID.project}`, net);
    const people = await screen.findByRole("region", { name: "People covered" });
    await userEvent.click(await within(people).findByLabelText(/Ada Admin/));
    await userEvent.click(within(people).getByRole("button", { name: "Save people" }));
    expect(await within(people).findByText("Saved.")).toBeInTheDocument();
    expect([...(net.calledWith("PUT", `/v1/projects/${ID.project}/members`)[0]?.body as { userIds: string[] }).userIds].sort()).toEqual([ID.admin, ID.alice].sort());
  });

  it("adds an approved destination from a URL and shows a validation error for a bad one", async () => {
    let attempts = 0;
    const net = fakeNetwork(
      detail({
        [`POST /v1/projects/${ID.project}/destinations`]: () =>
          ++attempts === 1 ? { status: 400, body: { code: "validation_failed", message: "The request is invalid.", issues: [{ path: "url", code: "credentials_in_url" }] } } : { status: 201, body: dest },
      }),
    );
    renderApp(`/projects/${ID.project}`, net);
    const section = await screen.findByRole("region", { name: "Approved destinations" });
    await userEvent.type(within(section).getByLabelText(/Add to approved destinations/), "https://user:pw@github.com/acme/portal");
    await userEvent.click(within(section).getByRole("button", { name: "Add" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent("The request is invalid.");
    await userEvent.clear(within(section).getByLabelText(/Add to approved destinations/));
    await userEvent.type(within(section).getByLabelText(/Add to approved destinations/), "https://github.com/acme/portal");
    await userEvent.click(within(section).getByRole("button", { name: "Add" }));
    await within(section).findByText("github.com/acme/portal");
    expect(net.calledWith("POST", `/v1/projects/${ID.project}/destinations`)).toHaveLength(2);
  });

  it("removes a destination", async () => {
    const net = fakeNetwork(detail({ [`DELETE /v1/projects/${ID.project}/destinations/${dest.id}`]: { status: 204 } }));
    renderApp(`/projects/${ID.project}`, net);
    const section = await screen.findByRole("region", { name: "Approved destinations" });
    await userEvent.click(await within(section).findByRole("button", { name: "Remove" }));
    expect(net.calledWith("DELETE", `/v1/projects/${ID.project}/destinations/${dest.id}`)).toHaveLength(1);
  });

  it("saves a new policy version from the version the editor was showing", async () => {
    const net = fakeNetwork(detail({ [`PUT /v1/projects/${ID.project}/policy`]: { body: { ...policy, version: 4, mode: "audit_only" } } }));
    renderApp(`/projects/${ID.project}`, net);
    await userEvent.selectOptions(await screen.findByLabelText("Mode"), "audit_only");
    await userEvent.click(screen.getByRole("button", { name: "Save new version" }));
    expect(await screen.findByText(/Saved\. Laptops pick it up/)).toBeInTheDocument();
    expect(net.calledWith("PUT", `/v1/projects/${ID.project}/policy`)[0]?.body).toEqual({ baseVersion: 3, mode: "audit_only", prohibitedGlobs: [".env", "*.pem"], secretRules: ["github_token"] });
  });

  it("explains an edit conflict instead of overwriting", async () => {
    const net = fakeNetwork(detail({ [`PUT /v1/projects/${ID.project}/policy`]: { status: 409, body: { code: "conflict", message: "The policy changed since version 3 (now 4). Reload and try again." } } }));
    renderApp(`/projects/${ID.project}`, net);
    await userEvent.click(await screen.findByRole("button", { name: "Save new version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this policy first");
  });

  it("shows the version history", async () => {
    renderApp(`/projects/${ID.project}`, fakeNetwork(detail()));
    expect(await screen.findByText("Version history")).toBeInTheDocument();
    const rows = within((await screen.findByText("Version history")).parentElement as HTMLElement).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
  });

  it("shows an error for a project that does not exist", async () => {
    renderApp(`/projects/${ID.project}`, fakeNetwork({ ...session, [`GET /v1/projects/${ID.project}`]: { status: 404, body: { code: "not_found", message: "The requested resource was not found." } } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
  });
});
