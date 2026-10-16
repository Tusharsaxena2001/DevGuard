import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { admin, event, metrics, page } from "./data.js";
import { fakeNetwork, renderApp } from "./helpers.js";

const session = { "GET /v1/auth/me": { body: admin } };

describe("overview", () => {
  it("shows a loading state, then the numbers from the server", async () => {
    renderApp("/", fakeNetwork({ ...session, "GET /v1/metrics/summary": { body: metrics() } }));
    expect(await screen.findByText("Loading...")).toBeInTheDocument();
    const decisions = await screen.findByRole("region", { name: "Decisions" });
    expect(within(decisions).getByText("40")).toBeInTheDocument();
    expect(within(decisions).getByText("Blocked").nextSibling).toHaveTextContent("5");
    const exceptions = screen.getByRole("region", { name: "Exceptions and devices" });
    expect(within(exceptions).getByText("Pending approvals").nextSibling).toHaveTextContent("2");
    expect(within(screen.getByRole("region", { name: "Top rules" })).getByText("destination_not_approved")).toBeInTheDocument();
  });

  it("is honest about what the numbers cover", async () => {
    renderApp("/", fakeNetwork({ ...session, "GET /v1/metrics/summary": { body: metrics() } }));
    expect(await screen.findByText(/--no-verify, another Git client/)).toBeInTheDocument();
  });

  it("shows friendly empty sections on a fresh system", async () => {
    renderApp("/", fakeNetwork({ ...session, "GET /v1/metrics/summary": { body: metrics({ topRules: [], blockedPerDay: [], recentIncidents: [] }) } }));
    expect(await screen.findByText("No rule has fired in this period.")).toBeInTheDocument();
    expect(screen.getByText("No blocked pushes in this period.")).toBeInTheDocument();
    expect(screen.getByText("Nothing has been blocked yet.")).toBeInTheDocument();
  });

  it("shows an error with a working retry", async () => {
    let fail = true;
    const net = fakeNetwork({ ...session, "GET /v1/metrics/summary": () => (fail ? { status: 500, body: { code: "internal_error", message: "An internal error occurred." } } : { body: metrics() }) });
    renderApp("/", net);
    expect(await screen.findByRole("alert")).toHaveTextContent("An internal error occurred.");
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Decisions" })).toBeInTheDocument();
  });

  it("asks for the chosen period", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/metrics/summary": { body: metrics() } });
    renderApp("/", net);
    await userEvent.selectOptions(await screen.findByLabelText("Period"), "24h");
    await screen.findByRole("region", { name: "Decisions" });
    expect(net.calledWith("GET", "/v1/metrics/summary").map((c) => c.query.get("range"))).toContain("24h");
  });
});

describe("events", () => {
  it("lists events with who, where and what was decided", async () => {
    renderApp("/events", fakeNetwork({ ...session, "GET /v1/events": { body: page([event()]) } }));
    const row = (await screen.findByText("github.com/personal/fork")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Alice Employee (alice-laptop)")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("blocked")).toBeInTheDocument();
  });

  it("shows an empty state that explains where events come from", async () => {
    renderApp("/events", fakeNetwork({ ...session, "GET /v1/events": { body: { items: [], total: 0, page: 1, pageSize: 25 } } }));
    expect(await screen.findByText("No events match")).toBeInTheDocument();
    expect(screen.getByText(/laptop with the DevGuard agent/)).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    renderApp("/events", fakeNetwork({ ...session, "GET /v1/events": { status: 500, body: { code: "internal_error", message: "An internal error occurred." } } }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("sends the filters the person chose and starts again from page 1", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/events": { body: { items: [event()], total: 60, page: 1, pageSize: 25 } } });
    renderApp("/events", net);
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.selectOptions(screen.getByLabelText("Decision"), "blocked");
    await userEvent.type(screen.getByLabelText("Rule"), "secret_detected");
    await userEvent.type(screen.getByLabelText(/Reference/), "corr-0001");
    await screen.findByText("github.com/personal/fork");
    const last = net.calledWith("GET", "/v1/events").at(-1);
    expect(Object.fromEntries(last?.query ?? [])).toMatchObject({ outcome: "blocked", ruleId: "secret_detected", correlationId: "corr-0001", page: "1" });
  });

  it("pages through results", async () => {
    const net = fakeNetwork({ ...session, "GET /v1/events": (call) => ({ body: { items: [event()], total: 60, page: Number(call.query.get("page")), pageSize: 25 } }) });
    renderApp("/events", net);
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText(/page 2 of 3/)).toBeInTheDocument();
  });

  it("opens the details: reference, findings by rule and path only, and a statement that an event does not prove leakage", async () => {
    const withFinding = event({ findings: [{ ruleId: "github_token", kind: "secret", path: "src/config.ts", line: 12 }], correlationId: "corr-ref-9999" });
    renderApp("/events", fakeNetwork({ ...session, "GET /v1/events": { body: page([withFinding]) } }));
    await userEvent.click(await screen.findByRole("button", { name: "Details" }));
    const details = await screen.findByRole("region", { name: "Event details" });
    expect(within(details).getByText("corr-ref-9999")).toBeInTheDocument();
    expect(within(details).getByText(/secret: github_token in src\/config.ts:12/)).toBeInTheDocument();
    expect(within(details).getByText(/never sends file contents or secret values/)).toBeInTheDocument();
    expect(within(details).getByText(/does not prove whether any data left or stayed/)).toBeInTheDocument();
  });
});
