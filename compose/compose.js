// Runs inside the message editor of every compose window. Inserts the HTML
// it receives from the background script at the current selection.
// Content scripts cannot be modules, so this file is self-contained.

(() => {
  if (globalThis.quicktextLiteComposeLoaded) return;
  globalThis.quicktextLiteComposeLoaded = true;

  // The native popup opens asynchronously. Keep input that arrives in the
  // editor between the shortcut and the popup taking focus out of the mail.
  let openingUntil = 0;
  let panelInput = [];
  let lastPanelInputAt = 0;
  // The command matches the character S, which some layouts put on another key.
  const isPanelShortcut = (event) => (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && (event.code === "KeyS" || event.key?.toLowerCase() === "s");
  const beginOpening = () => {
    if (Date.now() >= openingUntil) panelInput = [];
    lastPanelInputAt = Date.now();
    openingUntil = lastPanelInputAt + 1500;
    setTimeout(restoreUntaken, 1501);
  };
  // Nothing took the input in time (no panel opened, or the key was not the
  // command): give it back to the message instead of dropping it.
  const restoreUntaken = () => {
    if (Date.now() < openingUntil || !panelInput.length) return;
    const input = panelInput;
    panelInput = [];
    for (const part of input) {
      if (part.text) document.execCommand("insertText", false, part.text);
      else if (part.key === "Enter") document.execCommand("insertParagraph");
      else if (part.key === "Backspace") document.execCommand("delete");
    }
  };
  // A registered browser command can consume keydown before content sees it.
  // Its keyup still reaches the editor if the popup has not taken focus yet.
  document.addEventListener("keyup", (event) => {
    if (isPanelShortcut(event)) beginOpening();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (isPanelShortcut(event)) {
      beginOpening();
      return;
    }
    if (Date.now() >= openingUntil || event.isComposing) return;
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code);
    let input;
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && digit) {
      input = { number: Number(digit[1]) };
    } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.code === "KeyA") {
      // Select all would make the template replace the whole draft.
      input = { key: "SelectAll" };
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      if (["Enter", "Escape"].includes(event.key)) input = { key: event.key };
    }
    if (!input) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginOpening();
    panelInput.push(input);
  }, true);
  document.addEventListener("paste", (event) => {
    if (Date.now() >= openingUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginOpening();
    panelInput.push({ text: event.clipboardData.getData("text/plain") });
  }, true);
  document.addEventListener("beforeinput", (event) => {
    // Composition cannot be cancelled, so its text stays in the message only.
    if (Date.now() >= openingUntil || event.isComposing || event.inputType === "insertCompositionText") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginOpening();
    if (event.data !== null && event.data !== undefined) panelInput.push({ text: event.data });
    else if (event.inputType === "deleteContentBackward") panelInput.push({ key: "Backspace" });
  }, true);

  // Kept in case the editor loses its selection while the panel has focus.
  let lastRange = null;
  document.addEventListener("selectionchange", () => {
    const selection = document.getSelection();
    if (selection && selection.rangeCount) lastRange = selection.getRangeAt(0).cloneRange();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "prepare-panel") {
      // macOS can discard keys while the native popup takes focus. Finish
      // the initial typing burst in the editor before starting that handoff.
      if (Date.now() >= openingUntil) beginOpening();
      return new Promise((resolve) => {
        const check = () => {
          const remaining = 200 - (Date.now() - lastPanelInputAt);
          if (remaining > 0) setTimeout(check, remaining);
          else resolve();
        };
        check();
      });
    }
    if (message?.type === "take-panel-input") {
      const input = Date.now() < openingUntil ? panelInput : [];
      openingUntil = 0;
      panelInput = [];
      return Promise.resolve(input);
    }
    if (message?.type !== "insert-html") return undefined;
    return Promise.resolve(insertHtml(String(message.html ?? "")));
  });

  function insertHtml(html) {
    try {
      // Quicktext exports may contain an entire HTML document. Insert its
      // body fragment and stylesheet rules, without document metadata.
      if (/<(?:html|head|body)(?:\s|>)/i.test(html)) {
        const parsed = new DOMParser().parseFromString(html, "text/html");
        html = [...parsed.head.querySelectorAll("style")].map((style) => style.outerHTML).join("") + parsed.body.innerHTML;
      }
      const selection = document.getSelection();
      if (selection && !selection.rangeCount && lastRange) selection.addRange(lastRange);
      // insertHTML replaces the selected content and is a single undo step.
      const ok = document.execCommand("insertHTML", false, html);
      if (!ok) return { ok: false, error: "insertHTML was refused" };
      // Puts the cursor back into the message body, also when the insert
      // came from the panel or the focus was in the subject field.
      try {
        window.focus();
      } catch {}
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }
})();
