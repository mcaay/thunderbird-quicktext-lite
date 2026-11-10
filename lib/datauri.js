// Finds base64 data: URIs so the editor can show them as compact chips.
// Pure module.

const DATA_URI = /data:([a-z0-9.+-]+\/[a-z0-9.+-]+)((?:;[a-z0-9.+-]+=[^;,\s"'()<>]*)*);base64,([a-z0-9+/]+={0,2})/gi;

export function findDataUris(text) {
  const found = [];
  for (const match of text.matchAll(DATA_URI)) {
    found.push({
      from: match.index,
      to: match.index + match[0].length,
      mime: match[1].toLowerCase(),
      bytes: decodedSize(match[3]),
    });
  }
  return found;
}

export function decodedSize(base64) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// "[image PNG 45 KB]"; "svg+xml" is shown as "SVG".
export function chipLabel(mime, bytes, words = { image: "image", data: "data" }) {
  const [kind, subtype = ""] = mime.split("/");
  const word = kind === "image" ? words.image : words.data;
  return `[${word} ${subtype.split("+")[0].toUpperCase()} ${formatSize(bytes)}]`;
}
