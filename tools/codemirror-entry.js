// Entry point for vendor/codemirror.js: only what manager/editor.js uses.
export { EditorView, Decoration, WidgetType, keymap, lineNumbers, drawSelection } from "@codemirror/view";
export { EditorState, StateField } from "@codemirror/state";
export { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
export { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
export { html } from "@codemirror/lang-html";
export { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
