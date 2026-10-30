import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { useLinkPreviewDraft } from "@/hooks/useLinkPreviewDraft";
import LinkPreviewDraft from "./LinkPreviewDraft";
import MessageLinkPreview, { notifyPreviewState } from "./MessageLinkPreview";
vi.mock("./LinkPreviewCard", () => ({
  default: ({ url }: { url: string }) => <div data-testid="card">{url}</div>,
}));
function Draft({
  text = "https://outside.example/article",
  draftKey = "chat:1",
  secure = false,
}: {
  text?: string;
  draftKey?: string;
  secure?: boolean;
}) {
  const d = useLinkPreviewDraft(text, draftKey, secure);
  return (
    <>
      <LinkPreviewDraft
        url={d.url}
        suppressed={d.suppressed}
        onChange={d.setSuppressed}
      />
      <output>{String(d.suppressed)}</output>
    </>
  );
}
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (_url, options) =>
        new Response(
          JSON.stringify(
            options?.method === "POST"
              ? { hidden: true }
              : { hidden: false, suppressed: false, canSuppress: false },
          ),
          { status: 200 },
        ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("composer removes and restores external preview without changing text", () => {
  render(<Draft />);
  fireEvent.click(screen.getByRole("button", { name: "Отправить без превью" }));
  expect(screen.queryByTestId("card")).toBeNull();
  expect(screen.getByText("true")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Вернуть карточку" }));
  expect(screen.getByTestId("card")).toBeTruthy();
});
it("draft choice survives remount for same URL", () => {
  const v = render(<Draft />);
  fireEvent.click(screen.getByRole("button", { name: "Отправить без превью" }));
  v.unmount();
  render(<Draft />);
  expect(screen.queryByTestId("card")).toBeNull();
});
it("does not carry suppression to another URL or chat", () => {
  const v = render(<Draft />);
  fireEvent.click(screen.getByRole("button", { name: "Отправить без превью" }));
  v.rerender(<Draft text="https://other.example" />);
  expect(screen.getByTestId("card")).toBeTruthy();
  v.rerender(<Draft draftKey="chat:2" />);
  expect(screen.getByTestId("card")).toBeTruthy();
});
it("secure composer does not render or persist external metadata", () => {
  render(<Draft secure />);
  expect(screen.queryByTestId("card")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});
it("waits for server preference before loading a sent card", async () => {
  render(
    <MessageLinkPreview
      scope="dm"
      messageId="m1"
      url="https://outside.example"
    />,
  );
  await screen.findByTestId("card");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("scope=dm"),
    expect.objectContaining({ cache: "no-store" }),
  );
});
it("persisted personal hide blocks card on reload", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(
      JSON.stringify({ hidden: true, suppressed: false, canSuppress: false }),
    ),
  );
  render(
    <MessageLinkPreview
      scope="channel"
      messageId="m1"
      url="https://outside.example"
    />,
  );
  await screen.findByText("Превью скрыто у вас · Вернуть");
  expect(screen.queryByTestId("card")).toBeNull();
});
it("hiding a card posts a scoped personal choice", async () => {
  render(
    <MessageLinkPreview
      scope="dm"
      messageId="m1"
      url="https://outside.example"
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "× Скрыть у меня" }),
  );
  await screen.findByText("Превью скрыто у вас · Вернуть");
  expect(vi.mocked(fetch).mock.calls[1][1]?.body).toBe(
    JSON.stringify({
      scope: "dm",
      messageId: "m1",
      action: "personal",
      value: true,
    }),
  );
});
it("failed save keeps the card and shows an error", async () => {
  render(
    <MessageLinkPreview
      scope="dm"
      messageId="m1"
      url="https://outside.example"
    />,
  );
  const b = await screen.findByRole("button", { name: "× Скрыть у меня" });
  vi.mocked(fetch).mockRejectedValueOnce(Error("offline"));
  fireEvent.click(b);
  await screen.findByRole("alert");
  expect(screen.getByTestId("card")).toBeTruthy();
});
it("does not request preferences for an optimistic message", () => {
  render(
    <MessageLinkPreview
      scope="dm"
      messageId="opt-1"
      url="https://outside.example"
    />,
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("reacts to another device's suppression without changing message text", async () => {
  render(
    <MessageLinkPreview
      scope="dm"
      messageId="m1"
      url="https://outside.example"
    />,
  );
  await screen.findByTestId("card");
  act(() => notifyPreviewState({ scope: "dm", id: "m1", suppressed: true }));
  await waitFor(() => expect(screen.queryByTestId("card")).toBeNull());
});
