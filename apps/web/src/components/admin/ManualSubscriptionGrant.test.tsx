import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import Manual from "./ManualSubscriptionGrant";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("requires a reason and has no amount, card or acquiring controls", () => {
  render(<Manual userId="customer" grants={[]} onChanged={() => {}} />);
  fireEvent.click(screen.getByText("Ручная выдача и отзыв подписки"));
  fireEvent.click(screen.getByRole("button", { name: /Выдать/ }));
  expect(screen.getByRole("alert")).toHaveTextContent("основание"); expect(screen.queryByLabelText(/Сумма/)).toBeNull();
});
it("sends manual access not a payment and refreshes the registry after success", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ ok: true }) })); vi.stubGlobal("fetch", fetcher); const changed = vi.fn();
  render(<Manual userId="customer" grants={[]} onChanged={changed} />);
  fireEvent.click(screen.getByText("Ручная выдача и отзыв подписки"));
  fireEvent.change(screen.getByLabelText(/Основание/), { target: { value: "Выдача по обращению" } });
  fireEvent.click(screen.getByRole("button", { name: /Выдать/ })); await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls[0][0]).toBe("/api/admin/access-grants"); expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ action: "grant", userId: "customer", kind: "VPN", months: 1 });
});
