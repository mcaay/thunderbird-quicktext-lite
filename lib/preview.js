// The document shown in the manager's sandboxed preview frame. Pure module.

// The policy allows only images and inline styles. Remote images load as in
// the message itself: the templates are the user's own.
const POLICY = "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data:";

// Links aim at the top window, which the sandbox does not let the frame
// navigate, so a click in the preview cannot load a page into it.
export function previewDocument(html) {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${POLICY}">` +
    `<base target="_top">` +
    `<style>html{background:#fff;color:#000}body{margin:12px;font-family:sans-serif;font-size:14px}</style>` +
    `</head><body>${html}</body></html>`
  );
}
