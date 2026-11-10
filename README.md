# Quicktext Lite

A Thunderbird add-on that inserts saved HTML templates, such as signatures and standard replies, into the message you are writing.

## Features

- **Panel:** press Cmd+Shift+S (Ctrl+Shift+S on Windows and Linux) or click Quicktext Lite in the compose toolbar. Type to search (accents are ignored) and press Enter, or press Cmd/Ctrl+1 to 0 for one of the first ten templates.
- **Direct shortcuts:** Ctrl+Shift+1 to Ctrl+Shift+0 inserts templates 1 to 10 without opening the panel. On a Mac this is also Ctrl, not Cmd.
- **Context menu:** right-click in the message and choose Insert template.
- **Manager:** group templates, reorder them by drag and drop, edit their HTML with syntax highlighting and a preview, and embed images from files.
- **Import and backup:** import Quicktext exports (JSON or XML) and back up or restore your library.
- One Cmd/Ctrl+Z removes an inserted template.

Templates work only in HTML messages. Quicktext tags in double square brackets are inserted as plain text.

Every shortcut can be changed in the Add-ons Manager: gear menu, Manage Extension Shortcuts.

## Privacy

Quicktext Lite collects no data and has no servers. Templates are stored in Thunderbird on your computer. It uses only the standard MailExtension APIs, without Experiments, and asks for these permissions: `compose`, `scripting`, `menus`, `storage`.

## Requirements

Thunderbird 153 or later.

## Development

Requires Node.js 24 and npm 11.

```bash
npm ci
npm test
npm run build:vendor
npm run package
```

`npm run build:vendor` rebuilds `vendor/codemirror.js`, an unminified bundle of the pinned CodeMirror packages. `npm run package` writes `dist/quicktext-lite-<version>.xpi`. Both are reproducible byte for byte.

## License

MIT, see [LICENSE](LICENSE). Bundled CodeMirror packages: see [vendor/THIRD-PARTY-LICENSES.txt](vendor/THIRD-PARTY-LICENSES.txt).
