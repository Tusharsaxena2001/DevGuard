import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "../src/shared/ui/DataTable.js";
import { CopyButton } from "../src/shared/ui/CopyButton.js";
import { FilterPanel } from "../src/shared/ui/FilterPanel.js";
import { TextField } from "../src/shared/ui/Field.js";
import { ThemeToggle } from "../src/shared/ui/ThemeToggle.js";
import { applyTheme, readThemePref, resolveTheme, saveThemePref } from "../src/shared/lib/theme.js";
import { admin, ID } from "./data.js";
import { fakeNetwork, renderApp } from "./helpers.js";

/** jsdom has no layout, so the breakpoint is simulated: `desktop` answers the `(min-width: 1024px)` query. */
function setViewport(desktop: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width") ? desktop : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}
const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

interface Row {
  id: string;
  name: string;
  owner: string;
  status: string;
  revoked: boolean;
}
const rows: Row[] = [
  { id: "1", name: "alice-laptop", owner: "Alice", status: "active", revoked: false },
  { id: "2", name: "old-laptop", owner: "Bob", status: "revoked", revoked: true },
];
const columns: Column<Row>[] = [
  { header: "Owner", cell: (r) => r.owner },
  { header: "Device", cell: (r) => r.name, primary: true },
  { header: "Status", cell: (r) => r.status },
  { header: "", cell: (r) => (r.revoked ? null : <button type="button">Revoke {r.name}</button>) },
];

describe("DataTable: a table on large screens, cards on small ones", () => {
  it("renders a real table from 1024px, with an accessible name for the actions column", () => {
    setViewport(true);
    render(<DataTable label="Devices" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole("table", { name: "Devices" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Owner", "Device", "Status", "Actions"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("renders one card per row below 1024px: primary column as heading, label/value pairs, actions last", () => {
    setViewport(false);
    render(<DataTable label="Devices" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const cards = within(screen.getByRole("list", { name: "Devices" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    const first = cards[0] as HTMLElement;
    expect(first.firstElementChild).toHaveTextContent("alice-laptop"); // the primary column is the card heading
    expect(within(first).getByText("Owner")).toBeInTheDocument();
    expect(within(first).getByText("Status")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Revoke alice-laptop" })).toBeInTheDocument();
  });

  it("leaves no empty action area on a card whose action cell is empty", () => {
    setViewport(false);
    render(<DataTable label="Devices" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const second = within(screen.getByRole("list", { name: "Devices" })).getAllByRole("listitem")[1] as HTMLElement;
    expect(within(second).queryByRole("button")).not.toBeInTheDocument();
    expect(second.querySelectorAll("div.mt-3")).toHaveLength(0);
  });
});

describe("app shell on a small screen", () => {
  const session = { "GET /v1/auth/me": { body: admin } };

  it("keeps the navigation closed (and out of reach of the keyboard) until the menu button is used", async () => {
    setViewport(false);
    renderApp("/nowhere", fakeNetwork(session));
    const menu = await screen.findByRole("button", { name: "Open menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("primary-nav")).toHaveAttribute("inert");

    await userEvent.click(menu);
    expect(screen.getByRole("button", { name: "Close menu", expanded: true })).toBeInTheDocument();
    expect(document.getElementById("primary-nav")).not.toHaveAttribute("inert");
    // Focus moves into the drawer, onto the first link.
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Overview" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the menu button", async () => {
    setViewport(false);
    renderApp("/nowhere", fakeNetwork(session));
    await userEvent.click(await screen.findByRole("button", { name: "Open menu" }));
    await userEvent.keyboard("{Escape}");
    const menu = screen.getByRole("button", { name: "Open menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(menu).toHaveFocus();
    expect(document.getElementById("primary-nav")).toHaveAttribute("inert");
  });

  it("keeps Tab inside the open drawer", async () => {
    setViewport(false);
    renderApp("/nowhere", fakeNetwork(session));
    await userEvent.click(await screen.findByRole("button", { name: "Open menu" }));
    const drawer = document.getElementById("primary-nav") as HTMLElement;
    for (let i = 0; i < 12; i += 1) {
      await userEvent.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes after choosing a page", async () => {
    setViewport(false);
    renderApp("/nowhere", fakeNetwork({ ...session, "GET /v1/devices": { body: [] }, "GET /v1/users": { body: [] } }));
    await userEvent.click(await screen.findByRole("button", { name: "Open menu" }));
    await userEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Devices" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false"));
  });

  it("has a skip link that moves focus to the content, and sets a title per page", async () => {
    setViewport(true);
    renderApp("/nowhere", fakeNetwork(session));
    await screen.findByRole("link", { name: "Skip to content" });
    expect(document.title).toBe("Page not found - DevGuard");
    await userEvent.click(screen.getByRole("link", { name: "Skip to content" }));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("moves focus to the page heading after navigating, and updates the title", async () => {
    setViewport(true);
    renderApp("/nowhere", fakeNetwork({ ...session, "GET /v1/devices": { body: [] }, "GET /v1/users": { body: [] } }));
    await userEvent.click(await screen.findByRole("link", { name: "Devices" }));
    expect(await screen.findByRole("heading", { name: "Devices and people", level: 1 })).toHaveFocus();
    expect(document.title).toBe("Devices - DevGuard");
  });
});

describe("CopyButton", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("copies the text and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyButton text="the-text" label="Copy it" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy it" }));
    expect(writeText).toHaveBeenCalledWith("the-text");
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
  });

  it("tells the person to copy by hand when the browser refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    render(<CopyButton text="the-text" label="Copy it" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy it" }));
    expect(await screen.findByText(/select the text and copy it/)).toBeInTheDocument();
  });
});

describe("enrollment token panel", () => {
  it("offers the token and a ready-to-paste command (real token and server, no placeholders)", async () => {
    setViewport(true);
    const token = ["dgt", "synthetic", "token"].join("_");
    const net = fakeNetwork({
      "GET /v1/auth/me": { body: admin },
      "GET /v1/devices": { body: [] },
      "GET /v1/users": { body: [{ id: ID.alice, email: "alice@example.test", name: "Alice Employee", status: "active", isAdmin: false, createdAt: "2026-06-01T12:00:00.000Z" }] },
      "POST /v1/devices/enrollment-tokens": { status: 201, body: { token, expiresAt: "2026-06-01T12:30:00.000Z" } },
    });
    renderApp("/devices", net);
    await screen.findByRole("option", { name: /Alice Employee/ });
    await userEvent.selectOptions(screen.getByLabelText("Person"), ID.alice);
    await userEvent.click(screen.getByRole("button", { name: "Issue token" }));
    expect(await screen.findByRole("button", { name: "Copy token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeInTheDocument();
    const command = screen.getByText(/devguard enroll/);
    expect(command).toHaveTextContent(`echo '${token}'`);
    expect(command).toHaveTextContent(`--server ${window.location.origin}`);
    expect(command.textContent).not.toMatch(/<token>|<this server>/);
  });
});

describe("Add a person: per-field validation", () => {
  it("names each problem next to its field, marks the fields invalid, and sends nothing", async () => {
    setViewport(true);
    const net = fakeNetwork({ "GET /v1/auth/me": { body: admin }, "GET /v1/devices": { body: [] }, "GET /v1/users": { body: [] }, "POST /v1/users": { status: 201, body: {} } });
    renderApp("/devices", net);
    const form = await screen.findByRole("region", { name: "Add a person" });
    await userEvent.click(within(form).getByRole("button", { name: "Add person" }));
    expect(within(form).getByText("Enter a name.")).toBeInTheDocument();
    expect(within(form).getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(within(form).getByText("Use at least 12 characters.")).toBeInTheDocument();
    const email = within(form).getByLabelText("Email");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(net.calledWith("POST", "/v1/users")).toHaveLength(0);
  });
});

describe("TextField", () => {
  it("has no invalid state without an error", () => {
    render(<TextField label="Name" />);
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-invalid");
  });
});

describe("FilterPanel", () => {
  it("is toggled by a button that reports its state and the number of active filters", async () => {
    render(
      <FilterPanel activeCount={2}>
        <input aria-label="Rule" />
      </FilterPanel>,
    );
    const toggle = screen.getByRole("button", { name: /Filters \(2 active\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("theme", () => {
  it("applies the stored choice and falls back to the system setting", () => {
    setViewport(true);
    expect(readThemePref()).toBe("system");
    saveThemePref("dark");
    expect(readThemePref()).toBe("dark");
    applyTheme("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
  });

  it("still works when browser storage throws (private windows, blocked site data)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readThemePref()).toBe("system");
    expect(() => saveThemePref("dark")).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });

  it("cycles System -> Light -> Dark -> System, applies it and remembers it", async () => {
    render(<ThemeToggle />);
    const button = (): HTMLElement => screen.getByRole("button", { name: /Colour theme/ });
    expect(button()).toHaveTextContent("Theme: System");
    await userEvent.click(button());
    expect(button()).toHaveTextContent("Theme: Light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    await userEvent.click(button());
    expect(button()).toHaveTextContent("Theme: Dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem("devguard.theme")).toBe("dark");
    await userEvent.click(button());
    expect(button()).toHaveTextContent("Theme: System");
    expect(window.localStorage.getItem("devguard.theme")).toBeNull();
  });
});
