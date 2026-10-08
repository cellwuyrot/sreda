import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureMessageAnchor, restoreMessageAnchor } from "@/lib/chatHistory";
import { selectedReplyQuote } from "@/lib/replyQuote";

beforeEach(() => { document.body.innerHTML = ""; window.getSelection()?.removeAllRanges(); });
describe("reply selection", () => {
  function setup() {
    document.body.innerHTML = '<div id="row"><div data-message-body>first <strong>selected</strong> last</div><button>Reply</button></div><div id="outside">outside</div>';
    return document.getElementById("row")!;
  }
  it("uses exactly the selected body text", () => {
    const row=setup(); const range=document.createRange();range.selectNodeContents(row.querySelector("strong")!);window.getSelection()!.addRange(range);
    expect(selectedReplyQuote(row)).toBe("selected");
  });
  it("rejects selection spanning other messages", () => {
    const row=setup();const range=document.createRange();range.setStart(row.querySelector("strong")!.firstChild!,0);range.setEnd(document.getElementById("outside")!.firstChild!,3);window.getSelection()!.addRange(range);
    expect(selectedReplyQuote(row)).toBeNull();
  });
  it("does not quote toolbar labels", () => {
    const row=setup();const range=document.createRange();range.selectNodeContents(row.querySelector("button")!);window.getSelection()!.addRange(range);
    expect(selectedReplyQuote(row)).toBeNull();
  });
  it("falls back to normal reply without a selection", () => expect(selectedReplyQuote(setup())).toBeNull());
});
describe("message ID scroll anchors", () => {
  it("compensates real height shifts above the reader rather than distance to bottom", () => {
    const el=document.createElement("div");const row=document.createElement("div");row.dataset.messageId="m";el.append(row);document.body.append(el);
    Object.defineProperty(el,"clientHeight",{value:500});
    vi.spyOn(el,"getBoundingClientRect").mockReturnValue({top:100} as DOMRect);
    const measure=vi.spyOn(row,"getBoundingClientRect").mockReturnValue({top:90,bottom:150} as DOMRect);
    const anchor=captureMessageAnchor(el)!;expect(anchor).toEqual({id:"m",offset:-10});
    el.scrollTop=1000;measure.mockReturnValue({top:330,bottom:390} as DOMRect);
    expect(restoreMessageAnchor(el,anchor)).toBe(true);expect(el.scrollTop).toBe(1240);
  });
  it("does not scroll to an unrelated row when the anchor was deleted", () => {
    const el=document.createElement("div");el.scrollTop=42;
    expect(restoreMessageAnchor(el,{id:"gone",offset:0})).toBe(false);expect(el.scrollTop).toBe(42);
  });
});
