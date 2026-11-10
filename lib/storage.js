// Reads and writes the template library in storage.local.

import { emptyLibrary, validateLibrary } from "./library.js";

export const LIBRARY_KEY = "library";

export async function loadLibrary() {
  const { [LIBRARY_KEY]: raw } = await browser.storage.local.get(LIBRARY_KEY);
  return readLibrary(raw);
}

// Checks a stored value, also one delivered by storage.onChanged. status is
// "ok", "empty" (nothing saved yet) or "damaged". Damaged data is returned
// as `raw` and never overwritten here.
export function readLibrary(raw) {
  if (raw === undefined) return { status: "empty", library: emptyLibrary() };
  const result = validateLibrary(raw);
  if (result.ok) return { status: "ok", library: result.library };
  return { status: "damaged", library: emptyLibrary(), error: result.error, raw };
}

// One set() call, so a save is atomic.
export async function saveLibrary(library) {
  await browser.storage.local.set({ [LIBRARY_KEY]: library });
}
