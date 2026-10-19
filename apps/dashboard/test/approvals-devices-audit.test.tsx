import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ID, admin, exception, page } from "./data.js";
import { fakeNetwork, renderApp } from "./helpers.js";

const session = { "GET /v1/auth/me": { body: admin } };

describe("approvals", () => {
  it("shows a pending request with its scope and the reminder that secrets are still checked", async () => {
    renderApp("/approvals", fakeNetwork({ ...session, "GET /v1/exceptions": { body: page([exception()]) } }));
    expect(await screen.findByText(/Alice Employee wants Payments to push to github.com\/customer\/portal-copy/)).toBeInTheDocument();
    expect(screen.getByText(/Customer asked for a copy/)).toBeInTheDocument();
    expect(screen.getByText(/secrets and prohibited files are still checked/)).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("pending")).toBeInTheDocument();
  });

  it("shows an empty state, and asks only for pending requests by default", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/exceptions": { body: { items: [], total: 0, page: 1, pageSize: 25 } } });
    renderApp("/approvals", net);
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
    expect(net.calledWith("GET", "/v1/exceptions")[0]?.query.get("status")).toBe("pending");
  });

  it("approves with a reason and an expiry, sent as an ISO time", async () => {
    const net = fakeNetwork({
      ...session,
      "GET /v1/exceptions": { body: page([exception()]) },
      [`POST /v1/exceptions/${ID.exception}/approve`]: { body: exception({ status: "approved" }) },
    });
    renderApp("/approvals", net);
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await userEvent.type(screen.getByLabelText(/Reason/), "Approved for the customer handover");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(net.calledWith("POST", `/v1/exceptions/${ID.exception}/approve`)).toHaveLength(1));
    const body = net.calledWith("POST", `/v1/exceptions/${ID.exception}/approve`)[0]?.body as { reason: string; expiresAt: string };
    expect(body.reason).toBe("Approved for the customer handover");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.expiresAt).toMatch(/Z$/);
  });

  it("rejects with a reason", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/exceptions": { body: page([exception()]) }, [`POST /v1/exceptions/${ID.exception}/reject`]: { body: exception({ status: "rejected" }) } });
    renderApp("/approvals", net);
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await userEvent.type(screen.getByLabelText(/Reason/), "Use the approved mirror instead");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(net.calledWith("POST", `/v1/exceptions/${ID.exception}/reject`)[0]?.body).toEqual({ reason: "Use the approved mirror instead" }));
  });

  it("disables deciding on your own request and says why (the server enforces it too)", async () => {
    renderApp("/approvals", fakeNetwork({ ...session, "GET /v1/exceptions": { body: page([exception({ requesterId: ID.admin, requesterName: "Ada Admin" })]) } }));
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(screen.getByText(/This is your own request/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("shows the server's answer if it refuses a decision", async () => {
    const net = fakeNetwork({
      ...session,
      "GET /v1/exceptions": { body: page([exception()]) },
      [`POST /v1/exceptions/${ID.exception}/approve`]: { status: 403, body: { code: "self_approval_forbidden", message: "You cannot approve your own request." } },
    });
    renderApp("/approvals", net);
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await userEvent.type(screen.getByLabelText(/Reason/), "Approved for the customer handover");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/You cannot decide your own request/)).toBeInTheDocument();
  });

  it("offers to revoke an approval that is in force, and shows the decision history", async () => {
    const approved = exception({
      status: "approved",
      expiresAt: "2026-06-02T12:00:00.000Z",
      decisions: [{ decision: "approved", deciderId: ID.admin, deciderName: "Ada Admin", reason: "Approved for the handover", expiresAt: "2026-06-02T12:00:00.000Z", decidedAt: "2026-06-01T13:00:00.000Z" }],
    });
    const net = fakeNetwork({ ...session, "GET /v1/exceptions": { body: page([approved]) }, [`POST /v1/exceptions/${ID.exception}/revoke`]: { body: exception({ status: "revoked" }) } });
    renderApp("/approvals", net);
    expect(await screen.findByText(/approved by Ada Admin/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke..." }));
    await userEvent.type(screen.getByLabelText(/Reason/), "No longer needed after handover");
    await userEvent.click(screen.getByRole("button", { name: "Revoke approval" }));
    await waitFor(() => expect(net.calledWith("POST", `/v1/exceptions/${ID.exception}/revoke`)).toHaveLength(1));
  });

  it("shows an error state", async () => {
    renderApp("/approvals", fakeNetwork({ ...session, "GET /v1/exceptions": { status: 500, body: { code: "internal_error", message: "An internal error occurred." } } }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders a hostile reason as plain text, never as markup", async () => {
    renderApp("/approvals", fakeNetwork({ ...session, "GET /v1/exceptions": { body: page([exception({ reason: "<img src=x onerror=alert(1)> please approve this" })]) } }));
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

const device = (over: Record<string, unknown> = {}) => ({ id: ID.device, userId: ID.alice, name: "alice-laptop", os: "linux 6.8", agentVersion: "0.1.0", status: "active", enrolledAt: "2026-06-01T12:00:00.000Z", lastSeenAt: new Date().toISOString(), revokedAt: null, ...over });
const people = [
  { id: ID.alice, email: "alice@example.test", name: "Alice Employee", status: "active", isAdmin: false, createdAt: "2026-06-01T12:00:00.000Z" },
  { id: ID.admin, email: "admin@example.test", name: "Ada Admin", status: "active", isAdmin: true, createdAt: "2026-06-01T12:00:00.000Z" },
];

describe("devices", () => {
  it("lists devices with owner, status and last seen", async () => {
    const stale = device({ id: ID.event, name: "old-laptop", lastSeenAt: "2026-01-01T00:00:00.000Z" });
    renderApp("/devices", fakeNetwork({ ...session, "GET /v1/devices": { body: [device(), stale, device({ id: ID.project, name: "gone", status: "revoked", revokedAt: "2026-06-01T12:00:00.000Z" })] }, "GET /v1/users": { body: people } }));
    const row = (await screen.findByText("alice-laptop")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Alice Employee")).toBeInTheDocument();
    expect(within(row).getByText("active")).toBeInTheDocument();
    expect(within((await screen.findByText("old-laptop")).closest("tr") as HTMLElement).getByText("stale")).toBeInTheDocument();
    expect(within((await screen.findByText("gone")).closest("tr") as HTMLElement).getByText("revoked")).toBeInTheDocument();
  });

  it("shows an empty state that points at enrollment", async () => {
    renderApp("/devices", fakeNetwork({ ...session, "GET /v1/devices": { body: [] }, "GET /v1/users": { body: people } }));
    expect(await screen.findByText("No devices enrolled")).toBeInTheDocument();
  });

  it("issues a one-time token, shows it with the command to run, and sends only the person's id", async () => {
    const net = fakeNetwork({
      ...session,
      "GET /v1/devices": { body: [] },
      "GET /v1/users": { body: people },
      "POST /v1/devices/enrollment-tokens": { status: 201, body: { token: ["dgt", "synthetic", "token"].join("_"), expiresAt: "2026-06-01T12:30:00.000Z" } },
    });
    renderApp("/devices", net);
    await screen.findByRole("option", { name: /Alice Employee/ });
    await userEvent.selectOptions(screen.getByLabelText("Person"), ID.alice);
    await userEvent.click(screen.getByRole("button", { name: "Issue token" }));
    expect(await screen.findByText(/Copy this now\. It is shown once/)).toBeInTheDocument();
    expect(screen.getByText("dgt_synthetic_token")).toBeInTheDocument();
    expect(screen.getByText(/--token-stdin/)).toBeInTheDocument();
    expect(net.calledWith("POST", "/v1/devices/enrollment-tokens")[0]?.body).toEqual({ userId: ID.alice });
  });

  it("revokes a device only after the confirmation dialog is accepted; cancelling does nothing", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/devices": { body: [device()] }, "GET /v1/users": { body: people }, [`POST /v1/devices/${ID.device}/revoke`]: { body: device({ status: "revoked" }) } });
    renderApp("/devices", net);
    const revoke = `/v1/devices/${ID.device}/revoke`;
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Revoke .+\?/ });
    expect(dialog).toHaveTextContent("credentials stop working immediately");
    // Focus starts on the safe choice, and Cancel (or Escape) closes it without calling the server.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(net.calledWith("POST", revoke)).toHaveLength(0);
    // Accepting revokes.
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke device" }));
    await waitFor(() => expect(net.calledWith("POST", revoke)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("adds a person with a password of at least 12 characters", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/devices": { body: [] }, "GET /v1/users": { body: people }, "POST /v1/users": { status: 201, body: people[0] } });
    renderApp("/devices", net);
    const form = await screen.findByRole("region", { name: "Add a person" });
    await userEvent.type(within(form).getByLabelText("Name"), "Carol");
    await userEvent.type(within(form).getByLabelText("Email"), "carol@example.test");
    await userEvent.type(within(form).getByLabelText(/Initial password/), ["Carol", "Pass", "98765"].join("-"));
    await userEvent.click(within(form).getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(net.calledWith("POST", "/v1/users")).toHaveLength(1));
    expect(net.calledWith("POST", "/v1/users")[0]?.body).toMatchObject({ email: "carol@example.test", name: "Carol", isAdmin: false });
  });
});

describe("audit", () => {
  const entry = { id: ID.event, occurredAt: "2026-06-01T12:00:00.000Z", actorId: ID.admin, actorName: "Ada Admin", action: "policy.updated", targetType: "project", targetId: ID.project, summary: { fromVersion: 1, toVersion: 2, afterMode: "audit_only" } };

  it("lists changes with actor, action, target and summary", async () => {
    renderApp("/audit", fakeNetwork({ ...session, "GET /v1/audit": { body: page([entry]) } }));
    const row = (await screen.findByText("policy.updated")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Ada Admin")).toBeInTheDocument();
    expect(within(row).getByText(/toVersion: 2, afterMode: audit_only/)).toBeInTheDocument();
  });

  it("states that history is append-only, shows an empty state, and filters by kind of change", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/audit": { body: { items: [], total: 0, page: 1, pageSize: 25 } } });
    renderApp("/audit", net);
    expect(await screen.findByText("No changes match")).toBeInTheDocument();
    expect(screen.getByText(/cannot be edited or deleted/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Kind of change"), "exception");
    await waitFor(() => expect(net.calledWith("GET", "/v1/audit").at(-1)?.query.get("actionPrefix")).toBe("exception"));
  });

  it("shows an error state", async () => {
    renderApp("/audit", fakeNetwork({ ...session, "GET /v1/audit": { status: 500, body: { code: "internal_error", message: "An internal error occurred." } } }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
