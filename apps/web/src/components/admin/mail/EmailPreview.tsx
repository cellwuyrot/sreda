"use client";
import React from "react";
export function EmailPreview({ fullHtml, device }: { fullHtml: string; device: "desktop" | "mobile" }) {
  const width = device === "mobile" ? 380 : 680;
  return (
    <div style={{ display: "flex", justifyContent: "center", background: "#f4f4f7", padding: 16, borderRadius: 8 }}>
      <iframe title="email-preview" srcDoc={fullHtml} style={{ width, maxWidth: "100%", height: 600, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }} />
    </div>
  );
}
export default EmailPreview;
