import { afterEach, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PreviewContent } from "./LinkPreviewCard";
afterEach(cleanup);
const data = {
  url: "https://external.example/article",
  title: "External article",
  description: "A real site's content",
  image: "/api/link-preview/image?url=https%3A%2F%2Fcdn.example%2Fcover.jpg",
  favicon:
    "/api/link-preview/image?url=https%3A%2F%2Fexternal.example%2Ficon.png",
  siteName: "External",
  themeColor: "#FF6600",
};
it("uses third-party metadata and shows the real hostname", () => {
  render(<PreviewContent data={data} />);
  expect(screen.getByRole("link").getAttribute("href")).toBe(data.url);
  expect(screen.getByText("external.example")).toBeTruthy();
  expect(screen.getByText("External article")).toBeTruthy();
});
it("loads all images through our proxy, not Google or remote host", () => {
  const { container } = render(<PreviewContent data={data} />);
  for (const img of container.querySelectorAll("img"))
    expect(img.getAttribute("src")).toMatch(/^\/api\/link-preview\/image\?/);
});
it("does not accept an unproxied image supplied in metadata", () => {
  const { container } = render(
    <PreviewContent
      data={{
        ...data,
        image: "https://track.example/pixel",
        favicon: "https://google.example/favicon",
      }}
    />,
  );
  expect(container.querySelectorAll("img")).toHaveLength(0);
});
it("does not render dangerous destinations", () => {
  render(<PreviewContent data={{ ...data, url: "javascript:alert(1)" }} />);
  expect(screen.queryByRole("link")).toBeNull();
});
it("image failure keeps the clickable text card", () => {
  const { container } = render(<PreviewContent data={data} />);
  fireEvent.error(container.querySelector(".link-preview-media img")!);
  expect(container.querySelector(".link-preview-media")).toBeNull();
  expect(screen.getByRole("link")).toBeTruthy();
});
it("uses a compact layout for tiny source images", () => {
  const { container } = render(<PreviewContent data={data} />);
  const img = container.querySelector(".link-preview-media img")!;
  Object.defineProperty(img, "naturalWidth", { value: 32 });
  Object.defineProperty(img, "naturalHeight", { value: 32 });
  fireEvent.load(img);
  expect(screen.getByRole("link").classList.contains("is-compact")).toBe(true);
});
