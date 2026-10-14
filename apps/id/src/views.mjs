export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function page(title, content) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} · TZ ID</title><link rel="stylesheet" href="/style.css"></head><body><main><a class="brand" href="/">TZ <strong>ID</strong></a><h1>${escape(title)}</h1>${content}<footer>Единый аккаунт экосистемы TrioZ</footer></main></body></html>`;
}
export const styles = `:root{color-scheme:light dark;font-family:Arial,sans-serif;background:#f5f5fa;color:#171724}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,460px);background:#fff;border:1px solid #e4e3ed;border-radius:12px;padding:32px;box-shadow:0 20px 70px #1717240a}.brand{text-decoration:none;font-size:24px;letter-spacing:.03em;color:inherit}.brand strong{color:#7c3aed}h1{font-size:25px;margin:30px 0 12px}p,li{overflow-wrap:anywhere;line-height:1.6;color:#626277}label{display:block;font-size:14px;margin:18px 0 8px}input{width:100%;padding:14px;border-radius:12px;border:1px solid #d8d8e4;background:transparent;color:inherit;font:inherit}button,.button{display:block;width:100%;padding:14px;border:0;border-radius:12px;background:#7c3aed;color:white;font:inherit;font-weight:bold;text-align:center;text-decoration:none;margin-top:22px;cursor:pointer}button.secondary{background:transparent;border:1px solid #ccc;color:inherit}.error{background:#ef444411;border-radius:12px;color:#c22;padding:12px}a{color:#7c3aed}footer{margin-top:32px;font-size:14px;color:#777}@media(max-width:480px){body{padding:16px}main{padding:24px}}@media(prefers-color-scheme:dark){:root{background:#101017;color:#f5f5fa}main{background:#191920;border-color:#30303d}p,li{color:#b3b3c6}input{border-color:#444456}.brand strong,a{color:#a78bfa}}`;
