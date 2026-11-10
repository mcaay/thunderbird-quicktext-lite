# Quicktext Lite on addons.thunderbird.net

Texts used for the ATN listing and for the reviewers.

## Listing

- **Name:** Quicktext Lite
- **Summary:** Insert saved HTML templates into the message you are writing. Group them, pick them from a panel or the context menu, and insert the first ten with Cmd/Ctrl+1 to 0.
- **Category:** Message Composition
- **License:** MIT
- **Privacy policy:** none, the add-on collects no data.

### Description

Quicktext Lite keeps your HTML templates, such as signatures and standard replies, and inserts them into the message you are writing.

• Press Cmd+Shift+S (Ctrl+Shift+S on Windows and Linux) or click Templates in the compose toolbar. Type to search, accents are ignored, and press Enter. Cmd/Ctrl+1 to 0 inserts one of the first ten templates at once.
• Ctrl+Shift+1 to Ctrl+Shift+0 inserts templates 1 to 10 without opening the panel (on a Mac too: Ctrl, not Cmd).
• Right-click in the message to insert any template from the context menu.
• Group templates, reorder them by drag and drop, and edit their HTML with syntax highlighting and a preview.
• Embed images from files, so they travel with every message.
• Import your Quicktext templates from a JSON or XML export, and back up or restore your library.
• One Cmd/Ctrl+Z removes an inserted template.

Built only on the standard MailExtension APIs, without Experiments.

Templates work only in HTML messages. Quicktext tags in double square brackets are not supported and are inserted as plain text.

Privacy: Quicktext Lite collects no data and has no servers. Your templates stay in Thunderbird on your computer.

### Version notes

1.0.25: Ctrl+Shift+1 to Ctrl+Shift+0 inserts templates 1 to 10 without opening the panel (on a Mac too: Ctrl, not Cmd). New icon.

1.0.24: First public release.

## Notes for reviewers

How to test (Thunderbird 153 or later):
1. Open the add-on's options page (Add-ons Manager, Quicktext Lite, Options) and create a template, for example `<p><b>Hello</b> world</p>`.
2. Write a new HTML message. Press Cmd+Shift+S (Ctrl+Shift+S) or click the Templates toolbar button, type part of the name and press Enter, or press Cmd/Ctrl+1.
3. Right-click in the message body and choose Insert template.
4. Press Ctrl+Shift+1 (on macOS too: Ctrl, not Cmd): the first template is inserted without the panel.

Permissions:
- compose: getComposeDetails tells HTML messages from plain text ones.
- scripting: scripting.compose.registerScripts runs compose/compose.js in compose windows; executeScript injects it into a compose window where it is not running yet.
- menus: the Insert template context menu.
- storage: storage.local holds the template library, storage.session a little state per Thunderbird session.

Code:
- Templates are HTML written or imported by the user. compose/compose.js inserts them with document.execCommand("insertHTML"), so one undo removes them.
- The manager previews templates in an iframe with sandbox="" (no scripts, no same origin), filled through srcdoc.
- No remote code, no network requests of its own, no analytics.
- vendor/codemirror.js is an unminified esbuild bundle of unmodified release @codemirror packages (MIT). The attached source archive contains README.md with the build steps: npm ci, npm run build:vendor and npm run package give a byte-identical XPI, with the SHA-256 hashes listed there.
