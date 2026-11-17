// French typography (orthotypographie): one tool, rule by rule. Every rule can be turned on or off,
// and a dry run counts what each rule would change, with examples, before anything changes.
//
// Rules are GREP find/change pairs run on the stories in scope (master text included), plus the
// punctuation of bulleted lists, which needs the paragraphs. Defaults follow the usual French rules
// (Lexique des règles typographiques en usage à l'Imprimerie nationale); the contextual ones
// (quotes, multiplication sign) are off by default.

import { PAGES_SCRIPT, parsePageLines, resolvePageRefs } from './review-tools.js';
import { has } from '../lib/tool-context.js';

const NNBSP = '\u202F';   // espace fine insécable (InDesign: espace insécable à chasse fixe)
const NBSP = '\u00A0';    // espace mot insécable
const SPACES = '[ \\x{00A0}\\x{202F}\\x{2009}]';   // any space a rule may replace

// Words that take the œ ligature (stems: every form starting with them)
const OE_WORDS = ['coeur', 'oeuvr', 'soeur', 'oeil', 'oeill', 'boeuf', 'noeud', 'voeu', 'oeuf', 'manoeuvr', 'foetus', 'foetal', 'oesophag', 'oedème', 'oecuméni', 'oenolog', 'choeur', 'rancoeur', 'moeurs', 'oestrogène', 'coelacanthe', 'Oedipe', 'écoeur', 'désoeuvr'];
// Capitals that keep their accent (frequent words where the unaccented form is a mistake)
const ACCENTED = { Etat: 'État', Etats: 'États', Ecole: 'École', Ecoles: 'Écoles', Etude: 'Étude', Etudes: 'Études', Equipe: 'Équipe', Equipes: 'Équipes', Edition: 'Édition', Editions: 'Éditions', Eté: 'Été', Evénement: 'Événement', Evénements: 'Événements', Evènement: 'Événement', Ecran: 'Écran', Ecrans: 'Écrans', Economie: 'Économie', Education: 'Éducation', Elève: 'Élève', Elèves: 'Élèves', Energie: 'Énergie', Electricité: 'Électricité', Egalement: 'Également', Etape: 'Étape', Etapes: 'Étapes', Epoque: 'Époque', Evolution: 'Évolution', Eglise: 'Église' };
const A_GRAVE = ['la', 'l’', "l'", 'côté', 'partir', 'propos', 'savoir', 'travers', 'bientôt', 'nouveau', 'peine', 'moins', 'condition', 'cause', 'part', 'gauche', 'droite', 'noter', 'venir', 'suivre', 'vous', 'toi', 'moi', 'nous', 'eux', 'chaque', 'tout', 'tous', 'toutes', 'jamais', 'bord', 'pied', 'cet', 'cette', 'ce', 'ces', 'Paris', 'Montpellier'];
const MONTHS = 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre';
const UNITS = '€|\\$|£|%|‰|km|m|cm|mm|kg|g|mg|t|l|ml|cl|h|min|s|ms|°C|°|Mo|Go|Ko|To|px|pt|dpi|ppp|Hz|kHz|MHz|W|kW|V|ha|m²|m³|km²';

// rule id -> { on: default, what, steps: [{ find, change, position? }] }
export const RULES = {
  spaces: {
    on: true,
    what: 'Double spaces, spaces at the start or end of paragraphs, before , and . or inside ( ) and [ ] removed',
    steps: [
      { find: ' {2,}', change: ' ' },
      { find: '^ +| +$', change: '' },
      { find: `(?<=\\S)${SPACES}+(?=[,.](?!\\.))`, change: '' },
      { find: `(?<=[[:alnum:]])${SPACES}+(?=…|\\.{3})`, change: '' },
      { find: `(?<=[(\\[])${SPACES}+|${SPACES}+(?=[)\\]])`, change: '' },
    ],
  },
  high_punctuation: {
    on: true,
    what: `Thin no-break space before ; ! ? and word no-break space before : (no space before the second sign of ?! or after a URL / a time)`,
    // not inside URLs, code or times: a sign followed by a letter, a digit, = or / stays as it is
    steps: [
      { find: `(?<=[^\\s;!?:/])${SPACES}*([;!?]+)(?![[:alnum:]=&/])`, change: `${NNBSP}$1` },
      { find: `(?<=[^\\s:/\\d])${SPACES}*:(?![[:alnum:]/=])`, change: `${NBSP}:` },
      { find: `(?<=\\d)${SPACES}+:(?![[:alnum:]/=])`, change: `${NBSP}:` },
    ],
  },
  french_quotes_spacing: {
    on: true,
    what: 'Word no-break space inside « » (only where « » are already used)',
    steps: [
      { find: `«${SPACES}*`, change: `«${NBSP}` },
      { find: `${SPACES}*»`, change: `${NBSP}»` },
    ],
  },
  quotes: {
    on: false,
    what: 'Straight "double quotes" → « guillemets » with their spaces. Contextual: English text, code, inches (12") keep theirs; turn on when the text is French and the user wants it',
    steps: [
      { find: `^"${SPACES}*(?=\\S)`, change: `«${NBSP}` },
      { find: `(?<=[\\s(\\[—–-])"${SPACES}*(?=\\S)`, change: `«${NBSP}` },
      { find: `(?<=\\S)${SPACES}*"(?=$|[\\s.,;:!?)\\]…])`, change: `${NBSP}»` },
      { find: '“\\s*', change: `«${NBSP}` },
      { find: '\\s*”', change: `${NBSP}»` },
    ],
  },
  apostrophe: {
    on: true,
    what: 'Straight apostrophe between letters → typographic ’ (l\'été → l’été)',
    steps: [{ find: "(?<=[[:alpha:]])'(?=[[:alpha:]])", change: '’' }],
  },
  ellipsis: {
    on: true,
    what: '... → … (one character); « etc. » never followed by an ellipsis',
    steps: [
      { find: '\\.{3}', change: '…' },
      { find: '\\betc\\.?\\s*…', change: 'etc.' },
      { find: '\\betc\\.\\.+', change: 'etc.' },
    ],
  },
  numbers: {
    on: true,
    what: 'Thin no-break space between thousands (10 000), word no-break space before units, % and currencies (12 €, 30 %, 5 km)',
    steps: [
      // a group of 3 digits after 1-3 digits (a year followed by a number, 2024 300, is left alone)
      { find: '(?<!\\d{4})(?<=\\d)[ \\x{00A0}](?=\\d{3}(?!\\d))', change: NNBSP },
      { find: `(?<=\\d)${SPACES}?(?=(${UNITS})(?![[:alnum:]]))`, change: NBSP },
    ],
  },
  dates_names: {
    on: true,
    what: 'Word no-break space in dates (12 mars), after M., Mme, Dr, Me, n°, p., art., fig., chap., vol., §, and between a number and the word it counts (3 pages stays breakable)',
    steps: [
      { find: `(?<=\\d)${SPACES}+(?=(${MONTHS})\\b)`, change: NBSP },
      { find: `\\b(M\\.|MM\\.|Mme|Mmes|Mlle|Mlles|Dr|Pr|Me|Mgr|n°|N°|p\\.|pp\\.|art\\.|fig\\.|chap\\.|vol\\.)${SPACES}+(?=\\S)`, change: `$1${NBSP}` },
      { find: `§${SPACES}+(?=\\d)`, change: `§${NBSP}` },
    ],
  },
  dashes: {
    on: true,
    what: 'Spaced hyphen " - " → spaced en dash " – " (incise), number ranges 1990-2000 → 1990–2000 (not phone numbers or dates with more parts)',
    steps: [
      { find: `(?<=\\S)${SPACES}+-${SPACES}+(?=\\S)`, change: ' – ' },
      { find: '(?<![\\d./-])(\\d{1,4})-(\\d{1,4})(?![\\d./-])', change: '$1–$2' },
    ],
  },
  ordinals: {
    on: true,
    what: '1er, 2e, XIXe: ème / ième / me → e, suffix in superscript (1re, 2de, 3es)',
    // Roman numerals: two letters at least (XIXe, IIe), so "Le" or "Ce" never match
    steps: [
      { find: '(?<=\\d)(ième|ème|eme)(?=s?\\b)', change: 'e' },
      { find: '\\b([IVXLC]{2,6})(ième|ème|eme)(?=s?\\b)', change: '$1e' },
      { find: '(?<=\\d)(er|re|ers|res|e|es|nd|nde|nds|ndes)\\b', change: '$1', position: 'SUPERSCRIPT' },
      { find: '(?<=\\b[IVX][IVX])(er|re|e|es)\\b', change: '$1', position: 'SUPERSCRIPT' },
      { find: '(?<=\\b[IVX][IVX][IVX])(e|es)\\b', change: '$1', position: 'SUPERSCRIPT' },
    ],
  },
  ligatures: {
    on: true,
    what: 'oe → œ in the words that take it (cœur, œuvre, sœur, œil, bœuf, nœud, vœu, œuf, manœuvre…), capitals included',
    steps: OE_WORDS.flatMap((w) => {
      const lig = w.replace('oe', 'œ');
      const cap = w.charAt(0) === 'o' ? `Œ${w.slice(2)}` : w.charAt(0).toUpperCase() + lig.slice(1);
      return [
        { find: `\\b${w.replace("'", "['’]")}`, change: lig.replace("'", '’') },
        { find: `\\b${w.charAt(0).toUpperCase() + w.slice(1).replace("'", "['’]")}`, change: cap.replace("'", '’') },
        { find: `\\b${w.toUpperCase().replace("'", "['’]")}`, change: lig.toUpperCase().replace("'", '’') },
      ];
    }),
  },
  accented_capitals: {
    on: true,
    what: 'Accents on capitals: A la → À la (sentence start), Etat → État, Ecole → École, Equipe → Équipe…',
    steps: [
      { find: `^A (?=(${A_GRAVE.join('|')})\\b)`, change: 'À ' },
      { find: `(?<=[.!?…»] )A (?=(${A_GRAVE.join('|')})\\b)`, change: 'À ' },
      ...Object.entries(ACCENTED).map(([a, b]) => ({ find: `\\b${a}\\b`, change: b })),
    ],
  },
  multiplication: {
    on: false,
    what: 'Times sign between numbers: 3 x 4 → 3 × 4, 21x29,7 → 21 × 29,7 (dimensions). Contextual: off by default',
    steps: [{ find: '(?<=\\d)\\s?[xX]\\s?(?=\\d)', change: `${NNBSP}×${NNBSP}` }],
  },
};

const LIST_MODES = ['report', 'semicolon', 'none', 'period'];

export function createTypoTools(ctx) {
  const { run, respond, jsStr, jsNum, jsJson } = ctx;

  const definitions = [
    {
      name: 'french_typography',
      modifies: true,
      description: `French typography rules on text, rule by rule: ${Object.entries(RULES).map(([k, r]) => `${k}${r.on ? '' : ' (off by default)'}: ${r.what}`).join(' | ')} | lists: punctuation of bulleted lists (report by default; semicolon = items end with ; and the last with .; none; period). Scope: one story (frameId), pages, or the whole document (master text included). dryRun counts what each rule would change, with examples: run it first and let the user turn rules off (rules: { quotes: true, ordinals: false }).`,
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'The story of this text frame' },
          pages: { type: 'array', items: {}, description: 'The stories with text on these pages (a story that runs on goes with them)' },
          allPages: { type: 'boolean', description: 'Every story of the document', default: false },
          rules: { type: 'object', description: `Turn rules on or off, e.g. { "quotes": true, "ordinals": false }. Rules: ${Object.keys(RULES).join(', ')}` },
          only: { type: 'array', items: { type: 'string', enum: Object.keys(RULES) }, description: 'Run only these rules' },
          lists: { type: 'string', enum: LIST_MODES, description: 'Bulleted lists: report the punctuation (default), or fix it (semicolon, none, period)', default: 'report' },
          dryRun: { type: 'boolean', description: 'Count and show examples, change nothing', default: false },
        },
      },
    },
  ];

  const handlers = {};

  handlers.french_typography = async (args) => {
    const chosen = new Set(Object.entries(RULES).filter(([, r]) => r.on).map(([k]) => k));
    for (const [k, v] of Object.entries(args.rules || {})) {
      if (!RULES[k]) throw new Error(`Unknown rule: ${k}. Rules: ${Object.keys(RULES).join(', ')}`);
      if (v) chosen.add(k); else chosen.delete(k);
    }
    if (Array.isArray(args.only) && args.only.length) {
      for (const k of args.only) if (!RULES[k]) throw new Error(`Unknown rule: ${k}`);
      chosen.clear();
      args.only.forEach((k) => chosen.add(k));
    }
    const lists = args.lists || 'report';
    if (!LIST_MODES.includes(lists)) throw new Error(`lists: ${LIST_MODES.join(', ')}`);
    let scopeJs;
    if (has(args.frameId)) scopeJs = `(function () { var f = __findById(doc, ${jsNum(args.frameId, 'frameId')}); if (!f || f.constructor.name !== "TextFrame") throw new Error("No text frame with id " + ${jsNum(args.frameId, 'frameId')}); return [f.parentStory]; })()`;
    else if (Array.isArray(args.pages) && args.pages.length) {
      const idx = resolvePageRefs(args.pages, parsePageLines(await run(PAGES_SCRIPT))).map((p) => p.index);
      scopeJs = `(function () { var out = [], seen = {}, idx = ${jsJson(idx)}; for (var i = 0; i < idx.length; i++) { var tfs = doc.pages[idx[i]].textFrames; for (var k = 0; k < tfs.length; k++) { var s = tfs[k].parentStory; if (!seen[s.id]) { seen[s.id] = 1; out.push(s); } } } return out; })()`;
    } else if (args.allPages) scopeJs = '(function () { var out = []; for (var i = 0; i < doc.stories.length; i++) out.push(doc.stories[i]); return out; })()';
    else throw new Error('Say where: frameId, pages, or allPages: true');
    const rules = [...chosen].map((k) => ({ id: k, steps: RULES[k].steps }));
    const dry = !!args.dryRun;
    const out = String(await run(`
      var doc = __requireDoc();
      var stories = ${scopeJs}, rules = ${jsJson(rules)}, dry = ${dry ? 'true' : 'false'}, report = [];
      var mg = app.findChangeGrepOptions.includeMasterPages;
      app.findChangeGrepOptions.includeMasterPages = true;
      function ctxOf(t) {
        try { var s = t.parentStory.contents, a = Math.max(0, t.index - 18), b = Math.min(s.length, t.index + t.length + 18); return (s.substring(a, t.index) + "[" + s.substring(t.index, t.index + t.length) + "]" + s.substring(t.index + t.length, b)).replace(/[\\r\\n]+/g, " / "); } catch (e) { return ""; }
      }
      // lists first: the ; they add then gets its space from the rules
      // Bulleted lists: runs of paragraphs with bullets / numbers (or typed - • *), their final punctuation
      var listMode = ${jsStr(lists)}, listOut = [];
      function isItem(p) {
        try { if (String(p.bulletsAndNumberingListType).indexOf("NO_LIST") < 0) return true; } catch (e) {}
        return /^[\\s]*[•\\-–*·▪►✓][\\s\\u00A0]/.test(p.contents);
      }
      function endOf(t) { var m = /([.;,:!?…]?)[\\s\\u00A0]*$/.exec(t.replace(/[\\r\\n]+$/, "")); return m ? m[1] : ""; }
      for (var s2 = 0; s2 < stories.length; s2++) {
        var ps = stories[s2].paragraphs, run0 = [];
        for (var p = 0; p <= ps.length; p++) {
          var item = p < ps.length && isItem(ps[p]);
          if (item) { run0.push(ps[p]); continue; }
          if (run0.length >= 2) {
            var ends = [], fixed = 0;
            for (var q = 0; q < run0.length; q++) ends.push(endOf(run0[q].contents) || "∅");
            var first = run0[0].contents.replace(/[\\r\\n]+$/, "");
            var page = "";
            try { page = run0[0].parentTextFrames[0].parentPage.name; } catch (e) {}
            if (listMode !== "report" && !dry) {
              for (var q2 = 0; q2 < run0.length; q2++) {
                var want = listMode === "none" ? "" : (listMode === "period" ? "." : (q2 === run0.length - 1 ? "." : ";"));
                var txt = run0[q2].contents, body = txt.replace(/[\\r\\n]+$/, ""), cut = /[,.;]*[\\s\\u00A0]*$/.exec(body);
                var keepEnd = /[!?…]$/.test(body.replace(/[\\s\\u00A0]+$/, ""));
                if (keepEnd) continue;
                var start = run0[q2].characters[0].index, from = start + cut.index, to = start + body.length - 1;
                if (to >= from) run0[q2].parentStory.characters.itemByRange(from, to).contents = want;
                else if (want) run0[q2].parentStory.insertionPoints[start + body.length].contents = want;
                fixed++;
              }
            }
            listOut.push("p." + page + " \\"" + first.substr(0, 30) + "…\\" (" + run0.length + " items): endings " + ends.join(" ") + (fixed ? " → fixed" : ""));
          }
          run0 = [];
        }
      }
      try {
        for (var r = 0; r < rules.length; r++) {
          var n = 0, ex = [];
          for (var st = 0; st < rules[r].steps.length; st++) {
            var step = rules[r].steps[st];
            for (var s = 0; s < stories.length; s++) {
              app.findGrepPreferences = NothingEnum.nothing; app.changeGrepPreferences = NothingEnum.nothing;
              app.findGrepPreferences.findWhat = step.find;
              var found;
              if (dry) {
                found = stories[s].findGrep();
                for (var e = 0; e < found.length && ex.length < 3; e++) ex.push(ctxOf(found[e]));
              } else {
                app.changeGrepPreferences.changeTo = step.change;
                if (step.position) app.changeGrepPreferences.position = Position[step.position];
                found = stories[s].changeGrep();
              }
              n += found.length;
            }
          }
          report.push(rules[r].id + "\\t" + n + "\\t" + ex.join(" ‖ "));
        }
      } finally {
        app.findGrepPreferences = NothingEnum.nothing; app.changeGrepPreferences = NothingEnum.nothing;
        app.findChangeGrepOptions.includeMasterPages = mg;
      }
      report.join("\\n") + "\\nLISTS\\n" + listOut.join("\\n");
    `));
    const [rulesPart, listsPart = ''] = out.split('\nLISTS\n');
    const lines = rulesPart.split('\n').filter(Boolean).map((l) => {
      const [id, n, ex] = l.split('\t');
      return `  ${id}: ${n}${dry && ex ? ` — ${ex}` : ''}`;
    });
    const off = Object.keys(RULES).filter((k) => !chosen.has(k));
    const listLines = listsPart.split('\n').filter(Boolean);
    const text = [
      `${dry ? 'Dry run (nothing changed) – what each rule would change' : 'Changes per rule'}:`,
      ...lines,
      off.length ? `Rules off: ${off.join(', ')} (turn one on with rules: { name: true })` : '',
      listLines.length ? `Bulleted lists (${lists}):\n${listLines.map((l) => `  ${l}`).join('\n')}${lists === 'report' ? '\n  French rule: items introduced by ":" start in lower case and end with ";", the last one with "." (lists: "semicolon"); short items may take no punctuation (lists: "none"), the same in every list' : ''}` : 'Bulleted lists: none found',
    ].filter(Boolean);
    return respond(text.join('\n'), 'French Typography');
  };

  return { definitions, handlers };
}
