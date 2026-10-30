import { afterEach, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
const state = vi.hoisted(() => ({ path: "/admin/monitor", push: vi.fn() }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.path,
  useRouter: () => ({ push: state.push }),
}));
import Shell, { SYSTEM_SECTIONS, systemSection } from "./AdminSystemShell";
afterEach(cleanup);
it.each(SYSTEM_SECTIONS)("covers system page %s", (key, label) => {
  state.path = `/admin/${key}`;
  render(
    <Shell>
      <h1>{label}</h1>
    </Shell>,
  );
  expect(
    screen.getByRole("combobox", { name: "Раздел системы" }),
  ).toHaveProperty("value", key);
  expect(screen.getByRole("heading", { name: label })).toBeTruthy();
});
it("includes nested whitelist and services mail", () => {
  expect(systemSection("/admin/restrictions/whitelist")?.[0]).toBe(
    "restrictions",
  );
  expect(systemSection("/admin/services/mail")?.[0]).toBe("services");
});
it("leaves unrelated pages unchanged", () => {
  state.path = "/admin/users";
  render(
    <Shell>
      <p>Users</p>
    </Shell>,
  );
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText("Users")).toBeTruthy();
});
it("navigates without changing business data", () => {
  state.path = "/admin/monitor";
  render(
    <Shell>
      <h1>Monitor</h1>
    </Shell>,
  );
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "servers" },
  });
  expect(state.push).toHaveBeenCalledWith("/admin/servers");
});
