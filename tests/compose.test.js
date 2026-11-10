import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../compose/compose.js", import.meta.url), "utf8");

function editorContext(parsed) {
  const listeners = [];
  const insertions = [];
  const events = {};
  let now = 1000;
  const timers = [];
  let focused = false;
  const context = {
    Date: { now: () => now },
    setTimeout(callback, delay) { timers.push({ callback, at: now + delay }); },
    browser: { runtime: { onMessage: { addListener: (listener) => listeners.push(listener) } } },
    document: {
      addEventListener(type, listener) { events[type] = listener; },
      getSelection: () => ({ rangeCount: 1 }),
      execCommand(command, showUi, html) {
        assert.equal(command, "insertHTML");
        assert.equal(showUi, false);
        insertions.push(html);
        return true;
      },
    },
    window: { focus() { focused = true; } },
    DOMParser: class {
      parseFromString(html, type) {
        assert.equal(type, "text/html");
        assert.ok(parsed, "fragments should not be parsed as full documents");
        return parsed;
      }
    },
  };
  runInNewContext(source, context);
  return { context, listeners, insertions, events, advance: (ms) => {
    now += ms;
    for (const timer of timers.filter((timer) => timer.at <= now)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.callback();
    }
  }, focused: () => focused };
}

test("compose inserts a fragment in one native command and returns focus", async () => {
  const editor = editorContext();
  const result = await editor.listeners[0]({ type: "insert-html", html: "<b>Test</b>" });
  assert.equal(result.ok, true);
  assert.deepEqual(editor.insertions, ["<b>Test</b>"]);
  assert.equal(editor.focused(), true);
});

test("full-document templates insert the parsed body and styles without metadata", async () => {
  const fragment = '<p>Test<img src="data:image/png;base64,AA=="></p>';
  const editor = editorContext({
    head: { querySelectorAll: () => [{ outerHTML: "<style>p{color:red}</style>" }] },
    body: { innerHTML: fragment },
  });
  await editor.listeners[0]({ type: "insert-html", html: "<html><head><meta charset=utf-8></head><body>Test</body></html>" });
  assert.deepEqual(editor.insertions, ["<style>p{color:red}</style>" + fragment]);
});

test("re-injecting the compose script does not duplicate its message listener", () => {
  const editor = editorContext();
  runInNewContext(source, editor.context);
  assert.equal(editor.listeners.length, 1);
  assert.equal(editor.listeners[0]({ type: "unrelated" }), undefined);
});

function key(editor, code, modifiers = {}) {
  let prevented = false;
  const event = { code, key: code, preventDefault() { prevented = true; }, stopImmediatePropagation() {}, ...modifiers };
  editor.events.keydown(event);
  return prevented;
}

test("rapid panel shortcuts are consumed once instead of reaching the main window", async () => {
  const editor = editorContext();
  assert.equal(key(editor, "KeyS", { metaKey: true, shiftKey: true }), false);
  assert.equal(key(editor, "Digit1", { metaKey: true }), true);
  const input = await editor.listeners[0]({ type: "take-panel-input" });
  assert.equal(input[0].number, 1);
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" })).length, 0);
  assert.equal(key(editor, "Digit2", { metaKey: true }), false);
});

test("typing and pasting during popup opening do not alter the message", async () => {
  const editor = editorContext();
  editor.events.keyup({ code: "KeyS", metaKey: true, shiftKey: true });
  let typingPrevented = false;
  editor.events.beforeinput({ data: "ż", inputType: "insertText", preventDefault() { typingPrevented = true; }, stopImmediatePropagation() {} });
  assert.equal(typingPrevented, true);
  let prevented = false;
  editor.events.paste({ clipboardData: { getData: () => "ółw" }, preventDefault() { prevented = true; }, stopImmediatePropagation() {} });
  assert.equal(prevented, true);
  const input = await editor.listeners[0]({ type: "take-panel-input" });
  assert.equal(input.map(part => part.text).join(""), "żółw");
  assert.equal(editor.insertions.length, 0);
});

test("a failed or closed popup cannot keep intercepting editor input", async () => {
  const editor = editorContext();
  key(editor, "KeyS", { metaKey: true, shiftKey: true });
  editor.advance(1501);
  assert.equal(key(editor, "KeyA", { key: "a" }), false);
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" })).length, 0);
});

test("popup focus waits until the initial typing burst has finished", async () => {
  const editor = editorContext();
  key(editor, "KeyS", { metaKey: true, shiftKey: true });
  let ready = false;
  const preparing = editor.listeners[0]({ type: "prepare-panel" }).then(() => { ready = true; });
  editor.advance(150);
  editor.events.beforeinput({ data: "hotline", preventDefault() {}, stopImmediatePropagation() {} });
  editor.advance(50);
  await Promise.resolve();
  assert.equal(ready, false, "typing extends the wait before native focus changes");
  editor.advance(150);
  await preparing;
  assert.equal(ready, true);
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" }))[0].text, "hotline");
  assert.equal(editor.insertions.length, 0);
});

test("after 1500 ms without input the editor takes typing, Enter and Cmd+digit again", async () => {
  const editor = editorContext();
  editor.events.keyup({ code: "KeyS", metaKey: true, shiftKey: true });
  editor.advance(1501);
  let typingPrevented = false;
  editor.events.beforeinput({ data: "a", inputType: "insertText", preventDefault() { typingPrevented = true; }, stopImmediatePropagation() {} });
  assert.equal(typingPrevented, false);
  assert.equal(key(editor, "Enter"), false);
  assert.equal(key(editor, "Digit1", { metaKey: true }), false);
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" })).length, 0);
});

function beforeInput(editor, data, inputType = "insertText", extra = {}) {
  let prevented = false;
  editor.events.beforeinput({ data, inputType, preventDefault() { prevented = true; }, stopImmediatePropagation() {}, ...extra });
  return prevented;
}

// Records the editor commands that give buffered input back to the message.
function recordCommands(editor) {
  const commands = [];
  editor.context.document.execCommand = (command, showUi, value) => {
    commands.push(value === undefined ? command : `${command} ${value}`);
    return true;
  };
  return commands;
}

test("input that no panel takes goes back to the message 1500 ms after the last key", async () => {
  const editor = editorContext();
  const commands = recordCommands(editor);
  // Ctrl+Shift+S on macOS arms the buffer, but it is not the command.
  editor.events.keyup({ code: "KeyS", ctrlKey: true, shiftKey: true });
  beforeInput(editor, "H");
  editor.advance(1000);
  beforeInput(editor, "i");
  editor.advance(1000);
  key(editor, "Enter");
  key(editor, "Escape");
  key(editor, "Digit1", { metaKey: true });
  beforeInput(editor, "x");
  beforeInput(editor, null, "deleteContentBackward");
  editor.advance(1499);
  assert.deepEqual(commands, [], "nothing is given back while the window is open");
  editor.advance(2);
  assert.deepEqual(commands, ["insertText H", "insertText i", "insertParagraph", "insertText x", "delete"]);
  editor.advance(5000);
  assert.equal(commands.length, 5, "the input is given back once");
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" })).length, 0);
});

test("input the panel takes in time is never given back to the message", async () => {
  const editor = editorContext();
  const commands = recordCommands(editor);
  key(editor, "KeyS", { metaKey: true, shiftKey: true });
  beforeInput(editor, "hot");
  key(editor, "Enter");
  editor.advance(1400);
  const input = await editor.listeners[0]({ type: "take-panel-input" });
  assert.deepEqual([...input].map((part) => part.text ?? part.key), ["hot", "Enter"]);
  editor.advance(5000);
  assert.deepEqual(commands, []);
});

test("a panel that asks after the window gets nothing, and the text is back in the message", async () => {
  const editor = editorContext();
  const commands = recordCommands(editor);
  key(editor, "KeyS", { metaKey: true, shiftKey: true });
  beforeInput(editor, "hello");
  editor.advance(1600);
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" })).length, 0);
  assert.deepEqual(commands, ["insertText hello"]);
});

test("Cmd/Ctrl+A right after the shortcut does not select the whole message", async () => {
  const editor = editorContext();
  key(editor, "KeyS", { metaKey: true, shiftKey: true });
  assert.equal(key(editor, "KeyA", { metaKey: true }), true);
  assert.equal(key(editor, "KeyA", { ctrlKey: true }), true);
  beforeInput(editor, "hot");
  const input = await editor.listeners[0]({ type: "take-panel-input" });
  assert.equal([...input].map((part) => part.text ?? "").join(""), "hot");
  assert.equal(key(editor, "KeyA", { metaKey: true }), false, "after the handoff Cmd+A selects again");
});

test("IME composition during the window stays in the message and out of the search", async () => {
  const editor = editorContext();
  editor.events.keyup({ code: "KeyS", metaKey: true, shiftKey: true });
  for (const data of ["に", "にほ", "にほん"]) {
    assert.equal(beforeInput(editor, data, "insertCompositionText", { isComposing: true }), false);
  }
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" })).length, 0);
});

test("the shortcut arms the buffer on layouts that put S on another key", async () => {
  const editor = editorContext();
  // Dvorak puts S where QWERTY has the semicolon.
  assert.equal(key(editor, "Semicolon", { key: "S", metaKey: true, shiftKey: true }), false);
  assert.equal(beforeInput(editor, "a"), true);
  assert.equal((await editor.listeners[0]({ type: "take-panel-input" }))[0].text, "a");
});
