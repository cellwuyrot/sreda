import { expect, it } from "vitest";
import { validateWorkspace, parseWorkspaceRevision, isStaleWorkspaceRevision } from "./workspaceValidation";
const valid = () => ({ v: 3, activeId: "b", boards: [{ id: "b", name: "Board", view: { x: 0, y: 0, scale: 1 }, cards: [], edges: [] }] });
it("accepts a real empty v3 workspace", () => expect(validateWorkspace(valid())).toBe(true));
it.each([null, {}, { v: 3, boards: [null] }, { ...valid(), activeId: "missing" }])("rejects malformed snapshot %j", input => expect(validateWorkspace(input)).toBe(false));
it("rejects oversized board count and invalid viewport", () => {
  const snapshot = valid(); snapshot.boards[0].view.scale = -1; expect(validateWorkspace(snapshot)).toBe(false);
  expect(validateWorkspace({ ...valid(), boards: Array(6).fill(valid().boards[0]) })).toBe(false);
});
it("rejects duplicate cards and dangling edges", () => {
  const board = valid().boards[0];
  expect(validateWorkspace({ ...valid(), boards: [{ ...board, edges: [{ id: "e", from: "x", to: "y" }] }] })).toBe(false);
});
it("requires a parseable optimistic revision; null means create-only", () => {
  expect(parseWorkspaceRevision(null)).toBeNull(); expect(parseWorkspaceRevision(undefined)).toBeUndefined();
  expect(parseWorkspaceRevision("garbage")).toBeUndefined();
  expect(parseWorkspaceRevision("2026-10-27T10:00:00Z")?.toISOString()).toBe("2026-10-27T10:00:00.000Z");
});

it("checks card payloads and accepts all supported node kinds", () => {
  const base = { id: "c", x: 0, y: 0, z: 1, createdAt: 1, title: "Node", tags: [] };
  const cards = [
    { type: "note", body: "hello" }, { type: "link", url: "https://example.org", project: "" },
    { type: "image", src: "", caption: "" }, { type: "drawing", src: "", caption: "" },
    { type: "task", status: "todo", priority: "p2", progress: 0, deadline: "", note: "", checklist: [] },
    { type: "table", cells: [["a"]], hasHeader: true },
    { type: "document", docKind: "text", fileName: "a.txt", text: "", src: "", caption: "" },
    { type: "art", caption: "", scene: { w: 400, h: 300, layers: [], shapes: [{ id: "s", kind: "path", x: 0, y: 0, w: 10, h: 10, points: [0, 0, 10, 10] }] } },
  ];
  for (const card of cards) {
    const snapshot = valid();
    expect(validateWorkspace({ ...snapshot, boards: [{ ...snapshot.boards[0], cards: [{ ...base, ...card }] }] })).toBe(true);
  }
  const snapshot = valid();
  expect(validateWorkspace({ ...snapshot, boards: [{ ...snapshot.boards[0], cards: [{ ...base, type: "table", cells: [null], hasHeader: true }] }] })).toBe(false);
});

it("rejects a delayed remote read after a newer acknowledgement", () => {
  const current = "2026-10-27T10:00:01.000Z";
  expect(isStaleWorkspaceRevision(current, "2026-10-27T10:00:00.000Z")).toBe(true);
  expect(isStaleWorkspaceRevision(current, null)).toBe(true);
  expect(isStaleWorkspaceRevision(current, current)).toBe(false);
  expect(isStaleWorkspaceRevision(undefined, current)).toBe(false);
});
