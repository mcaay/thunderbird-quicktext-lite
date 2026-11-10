# Quicktext Lite on addons.thunderbird.net

Texts used for the ATN listing and for the reviewers.

## Listing

- **Name:** Quicktext Lite
- **Summary and description:** written by the author on ATN, in English and Polish.
- **Category:** Message Composition
- **License:** MIT
- **Privacy policy:** none, the add-on collects no data.

### Version notes

1.0.26: The compose toolbar button now says Quicktext Lite instead of Templates.

1.0.25: Ctrl+Shift+1 to Ctrl+Shift+0 inserts templates 1 to 10 without opening the panel (on a Mac too: Ctrl, not Cmd). New icon.

1.0.24: First public release.

## Notes for reviewers

How to test (Thunderbird 153 or later):
1. Open the add-on's options page (Add-ons Manager, Quicktext Lite, Options) and create a template, for example `<p><b>Hello</b> world</p>`.
2. Write a new HTML message. Press Cmd+Shift+S (Ctrl+Shift+S) or click the Quicktext Lite toolbar button, type part of the name and press Enter, or press Cmd/Ctrl+1.
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
