// HTML code editor (CodeMirror 6). Base64 data: URIs are shown as atomic
// chips such as "[image PNG 45 KB]": the cursor skips them, Backspace removes
// them whole, and copying still copies the full data.

import {
  EditorView,
  EditorState,
  StateField,
  Decoration,
  WidgetType,
  keymap,
  lineNumbers,
  drawSelection,
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
  syntaxHighlighting,
  defaultHighlightStyle,
  html,
  searchKeymap,
  highlightSelectionMatches,
} from "../vendor/codemirror.js";
import { findDataUris, chipLabel } from "../lib/datauri.js";

class ChipWidget extends WidgetType {
  constructor(label) {
    super();
    this.label = label;
  }

  eq(other) {
    return other.label === this.label;
  }

  toDOM() {
    const chip = document.createElement("span");
    chip.className = "cm-data-chip";
    chip.textContent = this.label;
    return chip;
  }
}

function chips(words) {
  const build = (doc) =>
    Decoration.set(
      findDataUris(doc.toString()).map(({ from, to, mime, bytes }) =>
        Decoration.replace({ widget: new ChipWidget(chipLabel(mime, bytes, words)) }).range(from, to),
      ),
      true,
    );
  return StateField.define({
    create: (state) => build(state.doc),
    update: (value, transaction) => (transaction.docChanged ? build(transaction.state.doc) : value),
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field)),
    ],
  });
}

const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "#fff", color: "#1f2328" },
  ".cm-scroller": { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: "12.5px" },
  ".cm-gutters": { backgroundColor: "#f6f8fa", color: "#8c959f", border: "none" },
});

export function createEditor(parent, { onChange, words }) {
  const extensions = [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightSelectionMatches(),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    html(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    theme,
    chips(words),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
    }),
  ];
  const view = new EditorView({ parent, state: EditorState.create({ doc: "", extensions }) });
  return {
    // A fresh state per template, so undo never crosses templates.
    setContent(text) {
      view.setState(EditorState.create({ doc: text, extensions }));
    },
    getContent() {
      return view.state.doc.toString();
    },
    insertAtCursor(text) {
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    },
  };
}
