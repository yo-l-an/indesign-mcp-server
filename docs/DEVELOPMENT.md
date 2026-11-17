# Development

How the server runs scripts in InDesign, how to debug and test it. Contributor rules for agents are in [CLAUDE.md](../CLAUDE.md).

## How scripts run

Each tool generates ExtendScript and writes it to a temp `.jsx` file. On macOS one long-running JXA process (`osascript -l JavaScript`, started on the first call) keeps the connection to InDesign and runs each file with `doScript`: about 15 ms per call instead of about 200 ms for a new `osascript` each time. If that worker cannot start, each call falls back to `do script (POSIX file "...") language javascript` through a fixed three-line AppleScript (`INDESIGN_EXECUTOR=osascript` forces the fallback). On Windows a small JScript file run with `cscript` creates the `InDesign.Application` COM object and calls `DoScript(path, ScriptLanguage.JAVASCRIPT)` (see `lib/launcher-windows.js`). Tool arguments never become part of the AppleScript or JScript launcher. Arguments are validated against the tool's schema before use, and embedded in scripts only as JSON string literals (`jsStr`), checked numbers (`jsNum`) or checked identifiers (`jsEnum`). The script's last expression is captured with `eval`, so multi-line final expressions work.

Execution goes through one module, `lib/executor.js`: it wraps the script, runs one script at a time, and reads a result envelope (`OK` + value, or `ERR` + code + line + message). A script fails only by throwing; the wording of a returned value never turns it into an error. Tests run the same executor with an in-memory adapter. Tool modules reach it only through the tool context (`lib/tool-context.js`), never through the server object. Errors carry InDesign's error number and never depend on its localised message text. Validation errors of the server itself (`No document open`, `Swatch not found: X`, `Paragraph style not found: X`, ...) are English and the same on every system.

### ExtendScript gotchas (for contributors)
- Never write `a === b ? x : c === d ? y : z`: InDesign's ExtendScript mis-parses chained ternaries with `===` (it returned the wrong branch). Use `if / else if`.
- Compare enums with `String(value).indexOf("NAME") === 0` rather than `===` against the enum constant inside larger expressions.
- Reserved words such as `char`, `int`, `long` cannot be variable names ("Illegal use of reserved word").
- Look objects up with `doc.pageItems.itemByID(id).getElements()[0]`; the plain result is a generic `PageItem` without type-specific properties.
- A PDF preset overrides `app.pdfExportPreferences` (bleed, slug); only `pageRange` is taken from the preferences.

### Debugging
Scripts live in `$TMPDIR/indesign-mcp/` (macOS) or `%TEMP%\indesign-mcp\` (Windows). A successful run deletes its script; a failed run **keeps** it and the error message ends with `[debug script: <path>]`. Kept scripts older than three days are removed automatically. Open the `.jsx` in the ExtendScript debugger, run it from InDesign's Scripts panel, or on macOS run it with `osascript -e 'tell application "Adobe InDesign 2026" to do script (POSIX file "<path>") language javascript'`.

## Testing

```bash
npm test
```

`tests/run-tests.mjs` starts InDesign if it is not running, drives the server over MCP and asserts the results against scratch documents: A5 landscape flyer with styles, frames, image placement, rotate, delete, PDF export (Print, Web, HighQualityPrint, PressQuality, page range, bleed, slug) and PNG/JPEG export at 72/100/300 dpi, plus error handling. It only closes documents it created itself. `npm run docs` regenerates the tool reference in [TOOLS.md](TOOLS.md).

`npm run test:offline` needs no InDesign: it checks the generated scripts and the argument handling (`test/`).

`npm run test:document` builds one real test file, `tests/output/mcp-test-document.indd` (plus a PDF and a PNG export), with layers, swatches, styles, text, Markdown, shapes, paths, a table, an image and page operations. Each step is checked. Set `KEEP_OPEN=1` to leave the document open in InDesign and look at it.

The live tests run on macOS and Windows. They use Helvetica Neue (macOS) or Segoe UI (Windows) with one extra style (Medium / Semibold); set `INDESIGN_TEST_FONT` and `INDESIGN_TEST_FONT_STYLE` to use another installed family. Exact CMYK values are only checked when the document profile is PSO Coated v3; with other colour settings (for example Coated FOGRA39) the colour tests check plausible values instead. On Windows, the file-symlink check is skipped unless Developer Mode or admin rights allow symlinks.

### README images

`npm run screenshots` renders the review images of the README into `assets/readme/` from fixture pages (`scripts/readme-screenshots.mjs`), with no InDesign. Run it after changing how review images are drawn.

## Troubleshooting

### Common Issues

**"Adobe InDesign not found"**
- Ensure InDesign is installed and running, or set `INDESIGN_APP_NAME` to its exact name if auto-detection picks the wrong one
- macOS: allow your MCP client to control InDesign in System Settings > Privacy & Security > Automation
- Windows: "not installed or not registered for scripting (COM error ...)" means the COM ProgID is missing. Check that `InDesign.Application` exists under `HKEY_CLASSES_ROOT`, set `INDESIGN_COM_PROGID` to a registered version, or repair the InDesign installation from the Creative Cloud app

**"Script execution failed"**
- Read the error: it carries the InDesign error code and, for unexpected failures, the path of the kept script (`[debug script: ...]`, see [Debugging](#debugging))
- Make sure no dialog is open in InDesign

**"Tool not found"**
- Restart MCP client after configuration changes
- Verify server is running with `node index.js`

### Debug Mode
```bash
node --inspect index.js
```
