import { describe, expect, it } from "vitest";
import { isValidEmail, parseRecipients, validateRecipients } from "./mailRecipients";
import { extensionOf, formatBytes, checkAttachment, checkAttachmentSet, MAX_TOTAL_SIZE } from "./mailAttachments";
import { markdownToHtml, htmlToText, escapeHtml } from "./mailMarkdown";
import { buildEmailHtml, extractVariables, applyVariables, EMAIL_CONTAINER_WIDTH } from "./mailLayout";

describe("MailKit libraries", () => {
  it("validates recipients", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(parseRecipients("A@B.CO, a@b.co  x@y.zz")).toEqual(["a@b.co", "x@y.zz"]);
    expect(validateRecipients({ to: ["a@b.co"] }).ok).toBe(true);
    expect(validateRecipients({ to: [] }).ok).toBe(false);
    expect(validateRecipients({ to: ["bad"] }).ok).toBe(false);
    expect(validateRecipients({ to: ["A@B.CO"] }).to[0]).toBe("a@b.co");
  });

  it("validates attachments", () => {
    expect(extensionOf("file.PDF")).toBe("pdf");
    expect(formatBytes(1536)).toBe("1.5 КБ");
    expect(checkAttachment({ name: "a.pdf", size: 1000 }).ok).toBe(true);
    expect(checkAttachment({ name: "a.exe", size: 1000 }).ok).toBe(false);
    expect(checkAttachment({ name: "a.pdf", size: 20 * 1024 * 1024 }).ok).toBe(false);
    expect(checkAttachmentSet([{ name: "a.pdf", size: MAX_TOTAL_SIZE }, { name: "b.pdf", size: 1024 }]).ok).toBe(false);
    expect(checkAttachmentSet([{ name: "a.pdf", size: 1024 }]).ok).toBe(true);
  });

  it("converts markdown safely", () => {
    expect(markdownToHtml("# Hi")).toContain("<h1>Hi</h1>");
    expect(markdownToHtml("**b**")).toContain("<strong>b</strong>");
    expect(markdownToHtml("- a")).toContain("<ul>");
    expect(markdownToHtml("- a")).toContain("<li>a</li>");
    expect(markdownToHtml("<script>")).toContain("&lt;script&gt;");
    expect(escapeHtml("<b>")).toBe("&lt;b&gt;");
    expect(htmlToText('<a href="http://x.io">link</a>')).toContain("http://x.io");
  });

  it("builds email layout and variables", () => {
    expect(EMAIL_CONTAINER_WIDTH).toBe(620);
    expect(buildEmailHtml({ bodyHtml: "<p>hey</p>", subject: "Subj" })).toContain("Subj");
    expect(extractVariables("{{name}} и {{ticket_id}}")).toHaveLength(2);
    expect(applyVariables("Привет {{name}}", { name: "Иван" })).toBe("Привет Иван");
    expect(applyVariables("{{unknown}}", {})).toBe("{{unknown}}");
    expect(applyVariables("{{unknown}}", {}, false)).toBe("");
  });
});
