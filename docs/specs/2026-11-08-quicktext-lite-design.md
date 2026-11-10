# Quicktext Lite: design

- Date: 2026-11-08
- Status: design approved in brainstorming, spec under review

## 1. Goal

A small Thunderbird add-on that inserts saved HTML templates (signatures, footers, canned replies) into the message being written. It replaces Quicktext for people who only need HTML snippets and avoids Quicktext's two problems: the "full, unrestricted access to Thunderbird and your computer" warning caused by Experiment APIs, and breakage after Thunderbird updates.

## 2. Scope

In scope (v1):

- HTML templates, optionally organised in groups. A template lives either at the top level or inside a group.
- Compose window: toolbar button with a panel, keyboard shortcuts, context menu.
- Template manager: HTML code editor with live preview.
- Import from Quicktext, export and import of backups.
- English and Polish user interface.

Out of scope (v1):

- Variables and Quicktext tags (`[[TO=...]]`, `[[DATE]]`, `[[CURSOR]]` and the rest).
- Keyword expansion, per-template subject, attachments, scripts.
- WYSIWYG editing, plain-text templates.
- A separate toolbar row in the compose window (impossible without Experiment APIs).
- Nested groups.
- Sync between profiles other than export and import.

## 3. Platform and permissions

- MailExtension, Manifest V3. No `experiment_apis`, no host permissions, no remote code.
- `strict_min_version`: `153.0`. Tested on Thunderbird 153.5.1 on macOS.
- Permissions: `compose`, `scripting`, `menus`, `storage`.
  - `compose` and `scripting`: register and inject the compose script that inserts HTML into the editor (`scripting.compose.registerScripts`, `scripting.executeScript`).
  - `menus`: context menu in the message body.
  - `storage`: the template library.
- Expected install prompt: one warning, "Read and modify your email messages as you compose and send them". Checked in testing (section 12).
- Add-on ID: `quicktext-lite@mcaay.github.io`.
- Background: non-persistent MV3 background script. All state lives in `storage.local`; all listeners are registered at the top level.
- Locales: `en` (default) and `pl`.

## 4. Compose window

### 4.1 Button

`compose_action` in the main composition toolbar (`default_area: "maintoolbar"`), where Quicktext's button is today. Icon plus the label "Templates" ("Szablony" in Polish). `type: "button"` with `default_popup: "popup/popup.html"`.

### 4.2 Shortcut that opens the panel

Command `open-template-panel` with suggested keys `Command+Shift+S` on macOS and `Ctrl+Shift+S` on Windows and Linux. Users can change it in the Add-ons Manager (Manage Extension Shortcuts).

Commands `insert-template-1` to `insert-template-9` and `insert-template-0` insert the template with that panel number (4.3) straight into the message, without opening the panel. Suggested keys: Ctrl+Shift+digit on every system. On macOS this is the Ctrl key (`MacCtrl` in the manifest), not Cmd, because macOS keeps Cmd+Shift+3, 4 and 5 for screenshots. A number without a template does nothing. A plain-text message gets the same "!" badge as an insert from the menu.

Why S: in current Thunderbird source, Cmd/Ctrl+Shift with A, B, C, G, I, J, K, L, M, O, P, R, T, V, X, Y and Z is already taken in the compose or main window, while S is free in both. Option+letter (macOS) and Ctrl+Alt+letter (AltGr on Windows) were rejected because they type Polish characters; Cmd+Shift+3/4/5 because macOS uses them for screenshots.

### 4.3 Panel

- Top: search field, focused when the panel opens.
- List in library order: top-level templates as rows; each non-empty group as a header (not clickable) followed by its templates, indented. Everything is expanded. Empty groups are hidden.
- Number hints: the first 10 templates in display order (templates inside groups count, headers do not) get the numbers 1 to 9 and 0, shown at the right of the row as `⌘1` on macOS and `Ctrl+1` elsewhere. Numbers depend only on the position in the library and stay the same while filtering. To change a number, the user moves the template in the manager.
- Keyboard:
  - Cmd+digit on macOS, Ctrl+digit elsewhere: insert that template.
  - Typing filters the list: case-insensitive and diacritics-insensitive substring match on the template name or the name of its group.
  - Up and Down move the highlight over the visible templates. The first visible template is highlighted by default. Enter inserts the highlighted template.
  - Esc closes the panel.
- Clicking a row inserts that template.
- Footer: "Manage templates" opens the manager.
- After a successful insert the panel closes. After a failure it stays open and shows the error.
- Empty library: a short message and a "Manage templates" button.
- Plain-text message: the list is replaced by "Templates work only in HTML messages."

### 4.4 Context menu

- In the message body (`menus` context `compose_body`): a parent item "Insert template" with the same structure as the panel (top-level templates as items, groups as submenus, library order), then a separator and "Manage templates".
- Rebuilt at startup and whenever the library changes (`storage.onChanged`).
- In a plain-text message the parent item is disabled and reads "Insert template (HTML only)" (`menus.onShown`, `menus.update`, `menus.refresh`).

### 4.5 Insertion

1. The panel sends `{type: "insert", templateId, tabId}` to the background. A context menu click is handled in the background directly. Both paths call the same insert function.
2. The insert function calls `compose.getComposeDetails(tabId)`. If `isPlainText` is true, it answers with the `plain-text` error.
3. It loads the template from storage and sends the HTML to the compose script with `tabs.sendMessage`.
4. The compose script inserts it with `document.execCommand("insertHTML", false, html)` at the current selection, replacing selected text, and focuses the editor. The insert is one undo step (Cmd/Ctrl+Z).
5. If the compose script is missing in that tab (for example, the window was open before the add-on was installed), the background injects it with `scripting.executeScript` and retries once.

Images keep their `data:` URIs, exactly as Quicktext inserts them today.

## 5. Template manager

Options page (`options_ui` with `open_in_tab: true`), opened from the panel, from the context menu or from the Add-ons Manager. `runtime.openOptionsPage()` focuses an already open manager tab instead of opening a second one.

Layout:

- Left: tree of groups and templates, with the buttons New template, New group, Delete, Import and Export.
  - Drag and drop: dropping a template on a group header moves it to the end of that group; dropping between rows puts the item at that position, inside a group when dropped among that group's templates. Groups can only be placed at the top level.
  - New template: with a group selected, it goes to the end of that group; with a template selected, right after it in the same place (group or top level); with nothing selected, to the end of the top level.
  - New group: always at the top level, right after the selected top-level item or after the group of the selected template; with nothing selected, at the end.
- Right, when a template is selected: name field, HTML editor, "Insert image from file" button, live preview.
- Right, when a group is selected: name field.

HTML editor (CodeMirror 6):

- HTML syntax highlighting and line wrapping.
- Every base64 `data:` URI is shown as an atomic chip such as `[image PNG 45 KB]` (MIME subtype and decoded size). The cursor skips over a chip, Backspace or Delete removes it whole, and copying a range that contains a chip copies the full data.
- "Insert image from file": file picker for `image/*`. The file is read as a data URI and `<img src="data:..." alt="">` is inserted at the cursor. Files above 1 MB show a non-blocking warning that every email with this template grows by that size.

Live preview: sandboxed iframe (`sandbox=""`, `srcdoc`), updated 300 ms after the last change.

Saving is automatic: 500 ms after the last change and when the page is hidden. A status line shows "Saved" or the error. Template and group names must not be empty; duplicate names are allowed.

Deleting asks for confirmation. Deleting a group deletes its templates, and the dialog says how many.

## 6. Data model and storage

`storage.local`, key `library`:

```json
{
  "version": 1,
  "items": [
    { "type": "template", "id": "3f1c...", "name": "Signature", "html": "<p>...</p>" },
    {
      "type": "group",
      "id": "8a2e...",
      "name": "Support",
      "templates": [
        { "type": "template", "id": "c41b...", "name": "Hotline", "html": "<p>...</p>" }
      ]
    }
  ]
}
```

- IDs come from `crypto.randomUUID()`.
- The whole library is written with one `storage.local.set` call, so every save is atomic.
- Writers: the manager (edits and import). Readers: the background (context menu, insertion) and the panel.
- A missing key means an empty library. Data that fails validation is never overwritten automatically: the manager shows an error and offers to download the raw data before starting with an empty library.

## 7. Import and export

Export (manager button) downloads `quicktext-lite-backup-YYYY-MM-DD.json` through a blob link, so no `downloads` permission is needed:

```json
{ "format": "quicktext-lite", "version": 1, "items": [] }
```

Import (manager button) opens a file picker and detects the format from the content:

| Format | Recognised by |
|---|---|
| Quicktext Lite backup | `"format": "quicktext-lite"` |
| Quicktext 6 export (JSON) | `templates.groups` and `templates.texts` as parallel arrays |
| Quicktext legacy file (XML) | root `<quicktext version="2">` with `filetype` `templates` or empty |

Mapping from Quicktext:

- Group becomes a group; text becomes a template (`name`; `text` or `<body>` becomes `html`).
- `type` `text/plain` (XML `type="0"`): the text is HTML-escaped and line breaks become `<br>`.
- Ignored: `shortcut`, `keyword`, `subject`, `attachments`, `protected`, scripts.
- Templates that contain Quicktext tags (`[[...]]`) are imported unchanged. The summary says how many there are, because the tags will be inserted as plain text.
- Option, on by default: a group that contains exactly one template with the same name (compared after trimming) becomes a top-level template. This undoes the usual Quicktext workaround for templates without a group.

Rules:

- The file is parsed and validated completely before anything is written. On any error nothing is imported and the reason is shown.
- Imported items are appended after the existing items. There is no merging and no deduplication.
- After an import, a summary shows how many templates and groups were imported and how many groups were turned into top-level templates.

## 8. Code structure

```
manifest.json
background.js          startup, compose script registration, insert routing
menus.js               context menu built from the library
lib/library.js         pure: validation, tree operations, numbering, filtering
lib/import.js          pure: format detection and conversion (XML parser passed in)
lib/backup.js          pure: export format
lib/storage.js         load and save the library
compose/compose.js     runs in the editor and inserts HTML
popup/                 panel: html, js, css
manager/               manager: html, js, css, editor.js (CodeMirror setup, data URI chips)
vendor/codemirror.js   CodeMirror 6 bundle built by tools/build-vendor.mjs, committed
_locales/en/, _locales/pl/
icons/
tests/                 node:test unit tests with synthetic fixtures
tools/                 build-vendor.mjs, package.mjs (creates dist/quicktext-lite-<version>.xpi)
package.json           dev dependencies only: CodeMirror packages, esbuild, @xmldom/xmldom
updates.json           update manifest for self-hosted updates
```

- Everything except `vendor/codemirror.js` is plain JavaScript (ES modules) shipped as written.
- Modules in `lib/` (except `storage.js`) use no WebExtension APIs, so the tests run them unchanged under Node. The XML import receives its parser as a parameter: `DOMParser` in Thunderbird, `@xmldom/xmldom` in tests.

Messages:

- Panel to background: `{type: "insert", templateId, tabId}`, answered with `{ok: true}` or `{ok: false, error}`, where `error` is `plain-text`, `not-found` or `insert-failed`. Context menu clicks reach the same insert function through `menus.onClicked` in the background.
- Background to compose script: `{type: "insert-html", html}`, answered with `{ok}`.
- The panel reads the library from storage and calls `compose.getComposeDetails` itself to choose between the list and the plain-text message.

## 9. Error handling

| Situation | Behaviour |
|---|---|
| Plain-text message | Panel shows the HTML-only message; context menu item is disabled. |
| Insert fails from the panel | Panel stays open and shows the error. |
| Insert fails from the context menu | The toolbar button gets a "!" badge in that tab and its tooltip carries the error; the panel shows it too. Cleared by the next successful insert. |
| Template deleted in the meantime | `not-found`, shown as above. |
| Save fails in the manager | Status line shows the error; the edits stay on screen and the next change retries. |
| Import fails | Error with the reason; nothing imported. |
| Damaged library data | Never overwritten automatically; the manager offers the raw download (section 6). |

## 10. Security

- No remote code and no network access. CodeMirror is bundled. Extension pages use the default MV3 content security policy.
- Template HTML is rendered only in the sandboxed preview iframe (no scripts, no same-origin access) and in Thunderbird's compose editor. It is never assigned to `innerHTML` in extension pages. Names are always set with `textContent`.
- Imported data is parsed with `JSON.parse` or `DOMParser`, validated field by field, and unknown fields are dropped.

## 11. Repository and releases

- Public GitHub repository under the MIT licence. First release: 1.0.0.
- README: features, screenshots, installation, what each permission is for, and a note that this is an independent project, not affiliated with Quicktext or its author.
- Releases: the XPI is attached to GitHub Releases. `browser_specific_settings.gecko.update_url` points to `updates.json` in the repository, so Thunderbird updates the add-on automatically. Thunderbird does not require add-on signing (`MOZ_REQUIRE_SIGNING` is off in Thunderbird builds), so the unsigned XPI installs from a file.
- Publishing on addons.thunderbird.net is a later, separate step. It would drop `update_url` and may require a different name because of the similarity to Quicktext.
- Real user templates never enter the repository. `.gitignore` covers `node_modules/`, `dist/` and backup files (`quicktext-lite-backup-*.json`).

## 12. Testing and verification

Automated tests (`node --test`) on synthetic fixtures:

- Library operations: add, rename, move, delete, the one-level rule, validation.
- Numbering (first 10 templates, headers skipped, unchanged by filtering) and filtering (case and diacritics).
- Import of all three formats, plain-text conversion, the flattening option, counting of Quicktext tags, rejection of invalid files without partial writes; export followed by import gives the same library.
- Data URI detection and size calculation for the editor chips.

Manual verification in the author's Thunderbird 153.5.1 (main profile, macOS), driven with computer use. Quicktext stays installed until the author removes it. No email is sent without the author's explicit consent.

1. Install the XPI. The prompt shows only the compose warning.
2. Import the author's Quicktext export and check the resulting structure.
3. New message: open the panel by click and by Cmd+Shift+S; insert every template by click, by Cmd+digit and by search plus Enter; check text and images in the editor; Cmd+Z removes the insert.
4. Reply and forward: insertion works.
5. Context menu: insert a top-level template and a template from a group.
6. Plain-text message: panel message and disabled menu item.
7. Shortcuts: Cmd+Shift+S triggers nothing else in the compose and main windows; Cmd+1 in the panel inserts and does not switch to the main window.
8. Manager: create, rename, drag and drop, delete, insert an image from a file, preview, autosave after a page reload and after a Thunderbird restart.
9. Restart Thunderbird: no add-on errors, add-on active.

## 13. Risks

| Risk | Checked in | Fallback |
|---|---|---|
| Thunderbird handles Cmd/Ctrl+1 (switch to the main window) before the panel sees it | Step 7 | Plain digits 1 to 9 and 0 insert while the search field is empty. |
| The editor loses its selection while the panel has focus | Step 3 | The compose script remembers the last selection range and restores it before inserting. |
| The install prompt shows more than the compose warning | Step 1 | The README explains the extra wording. |
| Cmd/Ctrl+Shift+S conflicts with something in 153.5.1 | Step 7 | Another letter that is free in both windows: D, E, H or N. |
