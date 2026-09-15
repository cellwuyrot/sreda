"use client";
/* PROJECT-MAIL: предпросмотр готового HTML-письма в iframe. */
export default function EmailPreview({ fullHtml, device }: { fullHtml: string; device: "desktop" | "mobile" }) {
  const width = device === "mobile" ? 380 : 680;
  return (
    <div className="flex justify-center overflow-auto rounded-lg bg-neutral-200 p-3">
      <iframe title="email-preview" srcDoc={fullHtml} sandbox="" style={{ width, height: 560, maxWidth: "100%", border: "0", background: "#fff", borderRadius: 8 }} />
    </div>
  );
}
