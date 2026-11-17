// run_script: a short ExtendScript for a case no tool covers yet (an unusual property, a one-off
// batch, a new feature that is not critical), without changing the server. Every run is noted in
// NOTES.md, so the author can turn a recurring need into a real tool.
//
// The script works on the open documents only: files, the system, menus, saving and exporting go
// through the dedicated tools (they check paths and ask for confirmation). execute_indesign_code
// stays the unrestricted escape hatch, off unless INDESIGN_ALLOW_ARBITRARY_CODE=1.

import { appendNote } from './notes-tools.js';
import { has } from '../lib/tool-context.js';

// What a document script must not do, with the tool to use instead
const DENY = [
  [/\b(File|Folder)\s*\(|\bnew\s+(File|Folder)\b|\b(File|Folder)\s*\.\s*(fs|decode|encode|current|temp|desktop|myDocuments|userData|appData|startup|trash|system)/, 'files and folders (place_image, export_*, save_document handle paths)'],
  [/\bSocket\b|\bcallSystem\b|\.execute\s*\(|\bdoScript\b|\$\s*\.\s*(evalFile|setenv|getenv|sleep)|#\s*(include|target|engine)/, 'the system or other scripts'],
  [/\bapp\s*\.\s*(quit|menuActions|scriptMenuActions|menus|panels|dialogs)|\.invoke\s*\(/, 'menus, dialogs and quitting InDesign'],
  [/\.(save|saveACopy|exportFile|packageForPrint|asynchronousExportFile|close)\s*\(/, 'saving, exporting and closing (save_document, export_pdf, export_images, close_document)'],
  [/\beval\s*\(|\bFunction\s*\(|\bnew\s+Function\b|\b(app|this)\s*\[|\$\s*(\[|\.\s*global)/, 'code or names built at run time'],
  [/\bapp\s*\.\s*(scriptPreferences|generalPreferences|activeScript)\b/, 'application preferences'],
];

export function checkDocumentScript(code) {
  for (const [re, what] of DENY) {
    if (re.test(code)) throw new Error(`run_script works on the document only; this script reaches ${what}. Use the dedicated tool, or ask the user to enable execute_indesign_code (INDESIGN_ALLOW_ARBITRARY_CODE=1) for a one-off.`);
  }
}

export function createScriptTools(ctx) {
  const definitions = [
    {
      name: 'run_script',
      modifies: true,
      description: 'Run a short ExtendScript (ES3) on the active document for a case no tool covers yet: a property the tools do not expose, a one-off batch over many objects, a check. Prefer it to changing the server when the need is particular or not critical. `doc` is the active document; __findById(doc, id) finds an object; lengths are mm with the origin at each page\'s top-left; the last expression is the result (return text: ids, values, what changed). Files, the system, menus, saving and exporting stay with their tools. Each run is noted in NOTES.md (purpose, missing tool, code) for the author; a need that comes back or blocks a task deserves a real tool instead.',
      inputSchema: {
        type: 'object',
        properties: {
          purpose: { type: 'string', description: 'One line: what the script does (it titles the note)' },
          code: { type: 'string', description: 'ExtendScript (ES3: var, function, no arrow functions or template strings); the last expression is the result' },
          missing: { type: 'string', description: 'What tool or option would have made the script unnecessary' },
          ids: { type: 'array', items: { type: 'number' }, description: 'Objects the script changes (their pages join the automatic snapshot, so review_compare shows the change)' },
          pageIndex: { type: 'number', description: 'Page the script changes (0-based), when it changes no object by id' },
        },
        required: ['purpose', 'code'],
      },
    },
  ];

  const handlers = {
    run_script: async (args) => {
      const code = String(args.code || '');
      if (!code.trim()) throw new Error('code is empty');
      if (code.length > 20000) throw new Error('code is longer than 20000 characters: split it, or ask for a real tool');
      checkDocumentScript(code);
      // the code runs inside a function so its variables stay local; its last expression is the result
      const body = code.replace(/;\s*$/, '');
      const result = await ctx.run(`
        var doc = __requireDoc();
        (function (doc) {
          var __r = eval(${ctx.jsStr(body)});
          return (__r === undefined || __r === null) ? "(no result)" : String(__r);
        })(doc);
      `);
      const { n, file } = appendNote({
        kind: 'workaround',
        status: 'workaround-found',
        tool: 'run_script',
        title: args.purpose,
        details: [
          has(args.missing) ? `Missing: ${args.missing}` : 'Missing: (not said)',
          '',
          '```javascript',
          code.trim(),
          '```',
        ].join('\n'),
      });
      return ctx.respond(`${result}\n(Noted as N${n} in ${file}: when this need comes back, it is a candidate for a real tool.)`, 'Run Script');
    },
  };

  return { definitions, handlers };
}
