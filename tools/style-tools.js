// Styles and colours: paragraph, character and object styles, swatches, applying colour.
//
// Moved out of index.js: each tool declares its schema, whether it modifies the document
// (`modifies`) and its handler in this one file. Handlers reach shared helpers (jsStr, jsNum,
// frameExpr, executeInDesignScript…) through `this`, which inherits from the server.

export function createStyleTools(server) {
  const definitions = [
    {
      name: 'create_paragraph_style',
      modifies: true,
      description: 'Create a paragraph style. Returns the font that was actually applied.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Style name' },
          baseStyle: { type: 'string', description: 'Base style to inherit from' },
          fontFamily: { type: 'string', description: 'Font family (error if not installed)' },
          fontStyle: { type: 'string', description: 'Font style: Regular, Medium, Bold, Italic, ...' },
          fontSize: { type: 'number', description: 'Font size in points' },
          leading: { type: 'number', description: 'Leading in points' },
          tracking: { type: 'number', description: 'Tracking in 1/1000 em' },
          kerning: { type: 'string', enum: ['Metrics', 'Optical'], description: 'Kerning method' },
          spaceBefore: { type: 'number', description: 'Space before in mm' },
          spaceBeforePt: { type: 'number', description: 'Space before in points (alternative to spaceBefore)' },
          spaceAfter: { type: 'number', description: 'Space after in mm' },
          spaceAfterPt: { type: 'number', description: 'Space after in points (alternative to spaceAfter)' },
          firstLineIndent: { type: 'number', description: 'First-line indent in mm' },
          leftIndent: { type: 'number', description: 'Left indent in mm' },
          rightIndent: { type: 'number', description: 'Right indent in mm' },
          alignment: { type: 'string', enum: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'JUSTIFY', 'LEFT_JUSTIFIED', 'CENTER_JUSTIFIED', 'RIGHT_JUSTIFIED', 'FULLY_JUSTIFIED'] },
          hyphenation: { type: 'boolean', description: 'Enable hyphenation' },
          keepWithNext: { type: 'number', description: 'Keep with next N lines (0 = off)' },
          keepLinesTogether: { type: 'boolean', description: 'Keep lines together' },
          keepFirstLines: { type: 'number', description: 'Keep first N lines together' },
          keepLastLines: { type: 'number', description: 'Keep last N lines together' },
          keepWithPrevious: { type: 'boolean', description: 'Keep with previous paragraph' },
          composer: { type: 'string', enum: ['paragraph', 'single-line'], description: 'Composer: "paragraph" = Adobe Paragraph Composer (default look), "single-line" = Adobe Single-line Composer' },
          capitalization: { type: 'string', enum: ['normal', 'small_caps', 'all_caps', 'cap_to_small_cap', 'lower_case'], description: 'Capitalisation' },
          ligatures: { type: 'boolean', description: 'Standard ligatures on/off' },
          openType: {
            type: 'object',
            description: 'OpenType features: booleans discretionaryLigatures, contextualAlternates, swash, titling, fractions, ordinals, slashedZero, historical; figureStyle (default, tabular_lining, proportional_oldstyle, proportional_lining, tabular_oldstyle); stylisticSets (bit mask number)',
            properties: {
              discretionaryLigatures: { type: 'boolean' }, contextualAlternates: { type: 'boolean' }, swash: { type: 'boolean' }, titling: { type: 'boolean' },
              fractions: { type: 'boolean' }, ordinals: { type: 'boolean' }, slashedZero: { type: 'boolean' }, historical: { type: 'boolean' },
              figureStyle: { type: 'string', enum: ['default', 'tabular_lining', 'proportional_oldstyle', 'proportional_lining', 'tabular_oldstyle'] },
              stylisticSets: { type: 'number' },
            },
          },
          hyphenateWordsLongerThan: { type: 'number', description: 'Hyphenation: minimum word length' },
          hyphenateAfterFirst: { type: 'number', description: 'Hyphenation: minimum letters before the hyphen' },
          hyphenateBeforeLast: { type: 'number', description: 'Hyphenation: minimum letters after the hyphen' },
          hyphenateLadderLimit: { type: 'number', description: 'Hyphenation: maximum consecutive hyphenated lines' },
          hyphenateCapitalizedWords: { type: 'boolean', description: 'Hyphenation: hyphenate capitalised words' },
          hyphenateLastWord: { type: 'boolean', description: 'Hyphenation: hyphenate the last word of a paragraph' },
          textColor: { type: 'string', description: 'Swatch name' },
        },
        required: ['name'],
      },
    },
    {
      name: 'modify_paragraph_style',
      modifies: true,
      description: 'Modify a paragraph style (same properties as create_paragraph_style). Returns the font that was actually applied.',
      inputSchema: {
        type: 'object',
        properties: {
          styleName: { type: 'string', description: 'Paragraph style name to modify' },
          baseStyle: { type: 'string', description: 'New base style' },
          fontFamily: { type: 'string', description: 'Font family (error if not installed)' },
          fontStyle: { type: 'string', description: 'Font style: Regular, Medium, Bold, Italic, ...' },
          fontSize: { type: 'number', description: 'Font size in points' },
          leading: { type: 'number', description: 'Leading in points' },
          tracking: { type: 'number', description: 'Tracking in 1/1000 em' },
          kerning: { type: 'string', enum: ['Metrics', 'Optical'], description: 'Kerning method' },
          spaceBefore: { type: 'number', description: 'Space before in mm' },
          spaceBeforePt: { type: 'number', description: 'Space before in points' },
          spaceAfter: { type: 'number', description: 'Space after in mm' },
          spaceAfterPt: { type: 'number', description: 'Space after in points' },
          firstLineIndent: { type: 'number', description: 'First-line indent in mm' },
          leftIndent: { type: 'number', description: 'Left indent in mm' },
          rightIndent: { type: 'number', description: 'Right indent in mm' },
          alignment: { type: 'string', enum: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'JUSTIFY', 'LEFT_JUSTIFIED', 'CENTER_JUSTIFIED', 'RIGHT_JUSTIFIED', 'FULLY_JUSTIFIED'] },
          hyphenation: { type: 'boolean', description: 'Enable hyphenation' },
          keepWithNext: { type: 'number', description: 'Keep with next N lines (0 = off)' },
          keepLinesTogether: { type: 'boolean', description: 'Keep lines together' },
          keepFirstLines: { type: 'number', description: 'Keep first N lines together' },
          keepLastLines: { type: 'number', description: 'Keep last N lines together' },
          keepWithPrevious: { type: 'boolean', description: 'Keep with previous paragraph' },
          composer: { type: 'string', enum: ['paragraph', 'single-line'], description: 'Composer: "paragraph" = Adobe Paragraph Composer (default look), "single-line" = Adobe Single-line Composer' },
          capitalization: { type: 'string', enum: ['normal', 'small_caps', 'all_caps', 'cap_to_small_cap', 'lower_case'], description: 'Capitalisation' },
          ligatures: { type: 'boolean', description: 'Standard ligatures on/off' },
          openType: {
            type: 'object',
            description: 'OpenType features: booleans discretionaryLigatures, contextualAlternates, swash, titling, fractions, ordinals, slashedZero, historical; figureStyle (default, tabular_lining, proportional_oldstyle, proportional_lining, tabular_oldstyle); stylisticSets (bit mask number)',
            properties: {
              discretionaryLigatures: { type: 'boolean' }, contextualAlternates: { type: 'boolean' }, swash: { type: 'boolean' }, titling: { type: 'boolean' },
              fractions: { type: 'boolean' }, ordinals: { type: 'boolean' }, slashedZero: { type: 'boolean' }, historical: { type: 'boolean' },
              figureStyle: { type: 'string', enum: ['default', 'tabular_lining', 'proportional_oldstyle', 'proportional_lining', 'tabular_oldstyle'] },
              stylisticSets: { type: 'number' },
            },
          },
          hyphenateWordsLongerThan: { type: 'number', description: 'Hyphenation: minimum word length' },
          hyphenateAfterFirst: { type: 'number', description: 'Hyphenation: minimum letters before the hyphen' },
          hyphenateBeforeLast: { type: 'number', description: 'Hyphenation: minimum letters after the hyphen' },
          hyphenateLadderLimit: { type: 'number', description: 'Hyphenation: maximum consecutive hyphenated lines' },
          hyphenateCapitalizedWords: { type: 'boolean', description: 'Hyphenation: hyphenate capitalised words' },
          hyphenateLastWord: { type: 'boolean', description: 'Hyphenation: hyphenate the last word of a paragraph' },
          textColor: { type: 'string', description: 'Swatch name' },
        },
        required: ['styleName'],
      },
    },
    {
      name: 'create_character_style',
      modifies: true,
      description: 'Create a new character style',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Style name' },
          fontFamily: { type: 'string', description: 'Font family' },
          fontStyle: { type: 'string', description: 'Font style (Regular, Bold, Italic)' },
          fontSize: { type: 'number', description: 'Font size in points' },
          textColor: { type: 'string', description: 'Text color' },
          tracking: { type: 'number', description: 'Character tracking' },
          baseStyle: { type: 'string', description: 'Base style to inherit from' },
        },
        required: ['name'],
      },
    },
    {
      name: 'modify_character_style',
      modifies: true,
      description: 'Modify properties of an existing character style',
      inputSchema: {
        type: 'object',
        properties: {
          styleName: { type: 'string', description: 'Character style name to modify' },
          fontFamily: { type: 'string', description: 'Font family' },
          fontStyle: { type: 'string', description: 'Font style (Regular, Bold, Italic)' },
          fontSize: { type: 'number', description: 'Font size in points' },
          textColor: { type: 'string', description: 'Text color (swatch name)' },
          tracking: { type: 'number', description: 'Character tracking' },
        },
        required: ['styleName'],
      },
    },
    {
      name: 'create_object_style',
      modifies: true,
      description: 'Create a new object style',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Style name' },
          fillColor: { type: 'string', description: 'Fill color (swatch name)' },
          strokeColor: { type: 'string', description: 'Stroke color (swatch name)' },
          strokeWidth: { type: 'number', description: 'Stroke width in points' },
          transparency: { type: 'number', description: 'Transparency percentage (0-100)' },
          baseStyle: { type: 'string', description: 'Base style to inherit from' },
        },
        required: ['name'],
      },
    },
    {
      name: 'modify_object_style',
      modifies: true,
      description: 'Modify properties of an existing object style',
      inputSchema: {
        type: 'object',
        properties: {
          styleName: { type: 'string', description: 'Object style name to modify' },
          fillColor: { type: 'string', description: 'Fill color (swatch name)' },
          strokeColor: { type: 'string', description: 'Stroke color (swatch name)' },
          strokeWidth: { type: 'number', description: 'Stroke width in points' },
          transparency: { type: 'number', description: 'Transparency percentage (0-100)' },
        },
        required: ['styleName'],
      },
    },
    {
      name: 'apply_paragraph_style',
      modifies: true,
      description: 'Apply a paragraph style to a text frame (or a character range of it)',
      inputSchema: {
        type: 'object',
        properties: {
          styleName: { type: 'string', description: 'Paragraph style name' },
          frameId: { type: 'number', description: 'Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex.' },
          frameIndex: { type: 'number', description: 'Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId.' },
          pageIndex: { type: 'number', description: 'Page index (0-based), used with frameIndex', default: 0 },
          startIndex: { type: 'number', description: 'Start character index (optional)' },
          endIndex: { type: 'number', description: 'End character index (optional)' },
        },
        required: ['styleName'],
      },
    },
    {
      name: 'apply_object_style',
      modifies: true,
      description: 'Apply an object style to an object (objectId, or pageIndex + objectIndex) or, if none is given, to the current selection',
      inputSchema: {
        type: 'object',
        properties: {
          styleName: { type: 'string', description: 'Object style name' },
          objectId: { type: 'number', description: 'Stable object id (preferred)' },
          objectIndex: { type: 'number', description: 'Index in list_page_items for that page (optional if objects are selected)' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
        },
        required: ['styleName'],
      },
    },
    {
      name: 'list_styles',
      modifies: false,
      description: 'List all available styles in the document',
      inputSchema: {
        type: 'object',
        properties: {
          styleType: { type: 'string', enum: ['paragraph', 'character', 'object', 'all'], default: 'all' },
        },
      },
    },
    {
      name: 'create_color_swatch',
      modifies: true,
      description: 'Create a colour swatch. Defaults to CMYK (values 0-100). RGB values (0-255) or a hex code are converted to CMYK in print documents with the colour management of InDesign (the CMYK profile of the document) unless keepRgb is true. Presets: rich_black (60/40/40/100), overprint_black (0/0/0/100; overprint is set per object with set_object_overprint).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Swatch name' },
          colorModel: { type: 'string', enum: ['CMYK', 'RGB'], default: 'CMYK' },
          colorValues: { type: 'array', description: '[C,M,Y,K] 0-100 for CMYK, or [R,G,B] 0-255 for RGB', items: { type: 'number' } },
          hex: { type: 'string', description: 'Alternative to colorValues: RGB hex such as #FF6600' },
          preset: { type: 'string', enum: ['rich_black', 'overprint_black'], description: 'Predefined CMYK values (overrides colorValues)' },
          keepRgb: { type: 'boolean', description: 'Keep RGB swatches as RGB even in a print document', default: false },
          spotColor: { type: 'boolean', description: 'Create as spot colour', default: false },
          update: { type: 'boolean', description: 'If a swatch with this name exists, change its values instead of failing (see also update_color_swatch)', default: false },
          conversion: { type: 'string', enum: ['profile', 'simple'], description: 'How RGB / hex values become CMYK: profile = InDesign\'s colour management with the document\'s CMYK profile (accurate, default); simple = plain formula without a profile (hues drift toward blue)', default: 'profile' },
        },
        required: ['name'],
      },
    },
    {
      name: 'apply_color',
      modifies: true,
      description: 'Apply color to an object',
      inputSchema: {
        type: 'object',
        properties: {
          objectId: { type: 'number', description: 'Stable object id (preferred)' },
          objectIndex: { type: 'number', description: 'Index in list_page_items for that page (shifts when the stacking order changes)' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          swatchName: { type: 'string', description: 'Color swatch name' },
          property: { type: 'string', enum: ['fill', 'stroke'], default: 'fill' },
        },
        required: ['swatchName'],
      },
    },
  ];

  const self = Object.assign(Object.create(server), {
    // Shared by create_paragraph_style and modify_paragraph_style
    paragraphStyleScript(mode, args) {
      const name = mode === 'create' ? args.name : args.styleName;
      if (!name) throw new Error(mode === 'create' ? 'name is required' : 'styleName is required');
      const a = args;
      const has = (v) => v !== undefined && v !== null;
      const lines = [];

      if (has(a.baseStyle)) lines.push(`pStyle.basedOn = __pstyle(doc, ${this.jsStr(a.baseStyle)});`);
      if (has(a.fontFamily)) {
        lines.push(`__applyFont(pStyle, ${this.jsStr(a.fontFamily)}, ${this.jsStr(a.fontStyle || 'Regular')});`);
      } else if (has(a.fontStyle)) {
        lines.push(`pStyle.fontStyle = ${this.jsStr(a.fontStyle)};`);
      }
      if (has(a.fontSize)) lines.push(`pStyle.pointSize = ${this.jsNum(a.fontSize, 'fontSize')};`);
      if (has(a.leading)) lines.push(`pStyle.leading = ${this.jsNum(a.leading, 'leading')};`);
      if (has(a.tracking)) lines.push(`pStyle.tracking = ${this.jsNum(a.tracking, 'tracking')};`);
      if (has(a.kerning)) {
        if (!['Metrics', 'Optical'].includes(a.kerning)) throw new Error(`Invalid kerning: ${a.kerning} (use Metrics or Optical)`);
        // kerningMethod takes the localised name ("Optique" in French InDesign); the $ID/ key works in every language
        lines.push(`pStyle.kerningMethod = ${this.jsStr('$ID/' + a.kerning)};`);
      }
      if (has(a.spaceBefore)) lines.push(`pStyle.spaceBefore = "${this.jsNum(a.spaceBefore, 'spaceBefore')}mm";`);
      if (has(a.spaceBeforePt)) lines.push(`pStyle.spaceBefore = "${this.jsNum(a.spaceBeforePt, 'spaceBeforePt')}pt";`);
      if (has(a.spaceAfter)) lines.push(`pStyle.spaceAfter = "${this.jsNum(a.spaceAfter, 'spaceAfter')}mm";`);
      if (has(a.spaceAfterPt)) lines.push(`pStyle.spaceAfter = "${this.jsNum(a.spaceAfterPt, 'spaceAfterPt')}pt";`);
      if (has(a.firstLineIndent)) lines.push(`pStyle.firstLineIndent = "${this.jsNum(a.firstLineIndent, 'firstLineIndent')}mm";`);
      if (has(a.leftIndent)) lines.push(`pStyle.leftIndent = "${this.jsNum(a.leftIndent, 'leftIndent')}mm";`);
      if (has(a.rightIndent)) lines.push(`pStyle.rightIndent = "${this.jsNum(a.rightIndent, 'rightIndent')}mm";`);
      if (has(a.alignment)) lines.push(`pStyle.justification = Justification.${this.jsEnum(a.alignment, 'alignment')};`);
      if (has(a.hyphenation)) lines.push(`pStyle.hyphenation = ${a.hyphenation ? 'true' : 'false'};`);
      if (has(a.keepWithNext)) lines.push(`pStyle.keepWithNext = ${this.jsNum(a.keepWithNext, 'keepWithNext')};`);
      if (has(a.keepLinesTogether)) lines.push(`pStyle.keepLinesTogether = ${a.keepLinesTogether ? 'true' : 'false'};`);
      if (has(a.keepFirstLines)) lines.push(`pStyle.keepFirstLines = ${this.jsNum(a.keepFirstLines, 'keepFirstLines')};`);
      if (has(a.keepLastLines)) lines.push(`pStyle.keepLastLines = ${this.jsNum(a.keepLastLines, 'keepLastLines')};`);
      if (has(a.textColor)) lines.push(`pStyle.fillColor = __swatch(doc, ${this.jsStr(a.textColor)});`);
      if (has(a.keepWithPrevious)) lines.push(`pStyle.keepWithPrevious = ${a.keepWithPrevious ? 'true' : 'false'};`);
      if (has(a.composer)) {
        // Locale-independent keys: the plain names ("Adobe Paragraph Composer") are rejected by localised InDesign
        const composers = { paragraph: '$ID/HL Composer', 'single-line': '$ID/HL Single' };
        if (!composers[a.composer]) throw new Error(`Invalid composer: ${a.composer} (use paragraph or single-line)`);
        lines.push(`pStyle.composer = ${this.jsStr(composers[a.composer])};`);
      }
      if (has(a.capitalization)) {
        const caps = { normal: 'NORMAL', small_caps: 'SMALL_CAPS', all_caps: 'ALL_CAPS', cap_to_small_cap: 'CAP_TO_SMALL_CAP', lower_case: 'LOWER_CASE' };
        if (!caps[a.capitalization]) throw new Error(`Invalid capitalization: ${a.capitalization} (use ${Object.keys(caps).join(', ')})`);
        lines.push(`pStyle.capitalization = Capitalization.${caps[a.capitalization]};`);
      }
      // Hyphenation details (hyphenation itself is on/off above)
      for (const [key, prop] of [['hyphenateWordsLongerThan', 'hyphenateWordsLongerThan'], ['hyphenateAfterFirst', 'hyphenateAfterFirst'], ['hyphenateBeforeLast', 'hyphenateBeforeLast'], ['hyphenateLadderLimit', 'hyphenateLadderLimit']]) {
        if (has(a[key])) lines.push(`pStyle.${prop} = ${this.jsNum(a[key], key)};`);
      }
      for (const key of ['hyphenateCapitalizedWords', 'hyphenateLastWord']) {
        if (has(a[key])) lines.push(`pStyle.${key} = ${a[key] ? 'true' : 'false'};`);
      }
      // Typography: ligatures and OpenType features
      if (has(a.ligatures)) lines.push(`pStyle.ligatures = ${a.ligatures ? 'true' : 'false'};`);
      if (has(a.openType)) {
        const flags = { discretionaryLigatures: 'otfDiscretionaryLigature', contextualAlternates: 'otfContextualAlternate', swash: 'otfSwash', titling: 'otfTitling', fractions: 'otfFraction', ordinals: 'otfOrdinal', slashedZero: 'otfSlashedZero', historical: 'otfHistorical' };
        const figures = { default: 'DEFAULT_VALUE', tabular_lining: 'TABULAR_LINING', proportional_oldstyle: 'PROPORTIONAL_OLDSTYLE', proportional_lining: 'PROPORTIONAL_LINING', tabular_oldstyle: 'TABULAR_OLDSTYLE' };
        for (const [key, value] of Object.entries(a.openType)) {
          if (flags[key]) {
            if (typeof value !== 'boolean') throw new Error(`openType.${key} must be true or false`);
            lines.push(`pStyle.${flags[key]} = ${value};`);
          } else if (key === 'figureStyle') {
            if (!figures[value]) throw new Error(`Invalid openType.figureStyle: ${value} (use ${Object.keys(figures).join(', ')})`);
            lines.push(`pStyle.otfFigureStyle = OTFFigureStyle.${figures[value]};`);
          } else if (key === 'stylisticSets') {
            lines.push(`pStyle.otfStylisticSets = ${this.jsNum(value, 'openType.stylisticSets')};`);
          } else {
            throw new Error(`Unknown openType feature: ${key} (use ${[...Object.keys(flags), 'figureStyle', 'stylisticSets'].join(', ')})`);
          }
        }
      }

      return `
        var doc = __requireDoc();
        var pStyle;
        ${mode === 'create' ? `
          if (doc.paragraphStyles.itemByName(${this.jsStr(name)}).isValid) {
            throw new Error("Paragraph style already exists: " + ${this.jsStr(name)} + " (use modify_paragraph_style)");
          }
          pStyle = doc.paragraphStyles.add();
          pStyle.name = ${this.jsStr(name)};
        ` : `
          pStyle = __pstyle(doc, ${this.jsStr(name)});
        `}
        try {
          ${lines.join('\n        ')}
        } catch (e) {
          ${mode === 'create' ? 'pStyle.remove();' : ''}
          throw e;
        }
        var fontName = "n/a";
        try { fontName = pStyle.appliedFont.name.replace("\\t", " "); } catch (e) { try { fontName = String(pStyle.appliedFont); } catch (e2) {} }
        "Paragraph style " + ${this.jsStr(name)} + " ${mode === 'create' ? 'created' : 'modified'}. font=" + fontName +
          " fontStyle=" + pStyle.fontStyle + " size=" + __r(pStyle.pointSize) + "pt leading=" + (pStyle.leading === Leading.AUTO ? "auto" : __r(pStyle.leading) + "pt") +
          " tracking=" + pStyle.tracking + " spaceBefore=" + __r(pStyle.spaceBefore) + "mm spaceAfter=" + __r(pStyle.spaceAfter) + "mm" +
          " firstLineIndent=" + __r(pStyle.firstLineIndent) + "mm leftIndent=" + __r(pStyle.leftIndent) + "mm hyphenation=" + pStyle.hyphenation +
          " composer=" + (function () {
            // InDesign reports the localised composer name; report the English one in every language
            try {
              var c = pStyle.composer;
              if (c === app.translateKeyString("$ID/HL Composer")) return "Adobe Paragraph Composer";
              if (c === app.translateKeyString("$ID/HL Single")) return "Adobe Single-line Composer";
              return c;
            } catch (e) { return "n/a"; }
          })() +
          " capitalization=" + (function () { try { return String(pStyle.capitalization); } catch (e) { return "n/a"; } })() +
          " ligatures=" + (function () { try { return pStyle.ligatures; } catch (e) { return "n/a"; } })();
      `;
    },

    async createParagraphStyle(args) {
      const result = await this.executeInDesignScript(this.paragraphStyleScript('create', args));
      return this.formatResponse(result, "Create Paragraph Style");
    },

    async modifyParagraphStyle(args) {
      const result = await this.executeInDesignScript(this.paragraphStyleScript('modify', args));
      return this.formatResponse(result, "Modify Paragraph Style");
    },

    // Shared by create_/modify_ character and object styles. kind: 'character' | 'object'
    simpleStyleScript(kind, mode, args) {
      const name = mode === 'create' ? args.name : args.styleName;
      if (!name) throw new Error(mode === 'create' ? 'name is required' : 'styleName is required');
      const a = args;
      const has = (v) => v !== undefined && v !== null;
      const coll = kind === 'character' ? 'characterStyles' : 'objectStyles';
      const label = kind === 'character' ? 'Character' : 'Object';
      const finder = kind === 'character' ? '__cstyle' : '__ostyle';
      const lines = [];

      if (has(a.baseStyle)) lines.push(`style.basedOn = ${finder}(doc, ${this.jsStr(a.baseStyle)});`);
      if (kind === 'character') {
        if (has(a.fontFamily)) lines.push(`__applyFont(style, ${this.jsStr(a.fontFamily)}, ${this.jsStr(a.fontStyle || 'Regular')});`);
        else if (has(a.fontStyle)) lines.push(`style.fontStyle = ${this.jsStr(a.fontStyle)};`);
        if (has(a.fontSize)) lines.push(`style.pointSize = ${this.jsNum(a.fontSize, 'fontSize')};`);
        if (has(a.tracking)) lines.push(`style.tracking = ${this.jsNum(a.tracking, 'tracking')};`);
        if (has(a.textColor)) lines.push(`style.fillColor = __swatch(doc, ${this.jsStr(a.textColor)});`);
      } else {
        if (has(a.fillColor)) lines.push(`style.fillColor = __swatch(doc, ${this.jsStr(a.fillColor)});`);
        if (has(a.strokeColor)) lines.push(`style.strokeColor = __swatch(doc, ${this.jsStr(a.strokeColor)});`);
        if (has(a.strokeWidth)) lines.push(`style.strokeWeight = ${this.jsNum(a.strokeWidth, 'strokeWidth')};`);
        if (has(a.transparency)) {
          const t = this.jsNum(a.transparency, 'transparency');
          if (t < 0 || t > 100) throw new Error('transparency must be 0-100');
          lines.push(`style.transparencySettings.blendingSettings.opacity = ${100 - t};`);
        }
      }
      if (mode === 'modify' && lines.length === 0) throw new Error(`No properties given to modify for ${kind} style ${name}`);

      return `
        var doc = __requireDoc();
        var style;
        ${mode === 'create' ? `
          if (doc.${coll}.itemByName(${this.jsStr(name)}).isValid) {
            throw new Error("${label} style already exists: " + ${this.jsStr(name)} + " (use modify_${kind}_style)");
          }
          style = doc.${coll}.add();
          style.name = ${this.jsStr(name)};
        ` : `
          style = ${finder}(doc, ${this.jsStr(name)});
        `}
        try {
          ${lines.join('\n        ')}
        } catch (e) {
          ${mode === 'create' ? 'style.remove();' : ''}
          throw e;
        }
        "${label} style " + ${this.jsStr(name)} + " ${mode === 'create' ? 'created' : 'modified'}." ${kind === 'character' ? `+ " fontStyle=" + style.fontStyle + " size=" + __r(style.pointSize) + "pt tracking=" + style.tracking` : `+ " stroke=" + __r(style.strokeWeight) + "pt opacity=" + __r(style.transparencySettings.blendingSettings.opacity) + "%"`};
      `;
    },

    async createCharacterStyle(args) {
      const result = await this.executeInDesignScript(this.simpleStyleScript('character', 'create', args));
      return this.formatResponse(result, "Create Character Style");
    },

    async modifyCharacterStyle(args) {
      const result = await this.executeInDesignScript(this.simpleStyleScript('character', 'modify', args));
      return this.formatResponse(result, "Modify Character Style");
    },

    async createObjectStyle(args) {
      const result = await this.executeInDesignScript(this.simpleStyleScript('object', 'create', args));
      return this.formatResponse(result, "Create Object Style");
    },

    async modifyObjectStyle(args) {
      const result = await this.executeInDesignScript(this.simpleStyleScript('object', 'modify', args));
      return this.formatResponse(result, "Modify Object Style");
    },

    async applyObjectStyle(args) {
      const { styleName } = args;
      const explicit = args.objectId !== undefined || args.objectIndex !== undefined;
      const num = (v, label) => (v === undefined || v === null ? 'null' : this.jsNum(v, label));

      const script = `
        var doc = __requireDoc();
        var oStyle = __ostyle(doc, ${this.jsStr(styleName)});
        var objectsToStyle = [];
        ${explicit ? `
          // An explicit object (id, or pageIndex + objectIndex) wins over the selection
          objectsToStyle.push(__resolve(doc, ${num(args.objectId, 'objectId')}, ${num(args.pageIndex, 'pageIndex')}, ${num(args.objectIndex, 'objectIndex')}));
        ` : `
          for (var i = 0; i < app.selection.length; i++) objectsToStyle.push(app.selection[i]);
          if (objectsToStyle.length === 0) {
            throw new Error("No objects selected. Select objects, or pass objectId / objectIndex.");
          }
        `}
        var appliedCount = 0;
        for (var j = 0; j < objectsToStyle.length; j++) {
          try {
            objectsToStyle[j].appliedObjectStyle = oStyle;
            appliedCount++;
          } catch (e) {}
        }
        if (appliedCount === 0) throw new Error("The style could not be applied to the given object(s)");
        "Object style " + ${this.jsStr(styleName)} + " applied to " + appliedCount + " object(s)";
      `;

      const result = await this.executeInDesignScript(script);
      return this.formatResponse(result, "Apply Object Style");
    },

    async applyParagraphStyle(args) {
      const { styleName, startIndex, endIndex } = args;
      const range = startIndex !== undefined && endIndex !== undefined;

      const script = `
        var doc = __requireDoc();
        var frame = ${this.frameExpr(args)};
        var style = __pstyle(doc, ${this.jsStr(styleName)});
        var story = frame.parentStory;
        ${range ? `
          story.characters.itemByRange(${this.jsNum(startIndex, 'startIndex')}, ${this.jsNum(endIndex, 'endIndex')}).paragraphs.everyItem().appliedParagraphStyle = style;
        ` : `
          story.paragraphs.everyItem().appliedParagraphStyle = style;
        `}
        "Paragraph style " + ${this.jsStr(styleName)} + " applied to text frame id=" + frame.id + " " + __overflowNote(frame);
      `;

      const result = await this.executeInDesignScript(script);
      return this.formatResponse(result, "Apply Paragraph Style");
    },

    async listStyles(args) {
      const { styleType = 'all' } = args;

      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          var result = "=== DOCUMENT STYLES ===\\n\\n";
        
          ${styleType === 'all' || styleType === 'paragraph' ? `
            result += "PARAGRAPH STYLES (" + doc.paragraphStyles.length + "):\\n";
            for (var i = 0; i < doc.paragraphStyles.length; i++) {
              result += "  • " + doc.paragraphStyles[i].name + "\\n";
            }
            result += "\\n";
          ` : ''}
        
          ${styleType === 'all' || styleType === 'character' ? `
            result += "CHARACTER STYLES (" + doc.characterStyles.length + "):\\n";
            for (var i = 0; i < doc.characterStyles.length; i++) {
              result += "  • " + doc.characterStyles[i].name + "\\n";
            }
            result += "\\n";
          ` : ''}
        
          ${styleType === 'all' || styleType === 'object' ? `
            result += "OBJECT STYLES (" + doc.objectStyles.length + "):\\n";
            for (var i = 0; i < doc.objectStyles.length; i++) {
              result += "  • " + doc.objectStyles[i].name + "\\n";
            }
          ` : ''}
        
          result;
        }
      `;

      const result = await this.executeInDesignScript(script);
      return this.formatResponse(result, "List Styles");
    },

    async createColorSwatch(args) {
      const { name, colorModel = 'CMYK', colorValues, hex, preset, keepRgb = false, spotColor = false, update = false, conversion = 'profile' } = args;
      if (!name) throw new Error('name is required');
      if (!['profile', 'simple'].includes(conversion)) throw new Error(`Invalid conversion: ${conversion} (use profile or simple)`);

      const presets = { rich_black: [60, 40, 40, 100], overprint_black: [0, 0, 0, 100] };
      let model = colorModel;
      let values = colorValues;
      if (preset) {
        if (!presets[preset]) throw new Error(`Unknown preset: ${preset} (use ${Object.keys(presets).join(', ')})`);
        model = 'CMYK';
        values = presets[preset];
      } else if (hex !== undefined) {
        model = 'RGB';
        values = this.parseHex(hex);
      }
      if (!['CMYK', 'RGB'].includes(model)) throw new Error(`Invalid colorModel: ${model} (use CMYK or RGB)`);
      if (!Array.isArray(values) || values.length !== (model === 'CMYK' ? 4 : 3) || values.some((v) => !Number.isFinite(Number(v)))) {
        throw new Error(`colorValues must be ${model === 'CMYK' ? '[C,M,Y,K] (0-100)' : '[R,G,B] (0-255)'}`);
      }
      values = values.map(Number);

      const script = `
        var doc = __requireDoc();
        var existing = doc.colors.itemByName(${this.jsStr(name)});
        if (doc.swatches.itemByName(${this.jsStr(name)}).isValid && !(${update ? 'true' : 'false'} && existing.isValid)) {
          throw new Error("Swatch already exists: " + ${this.jsStr(name)} + " (pass update: true to change its values, or use update_color_swatch)");
        }
        var model = ${this.jsStr(model)};
        var values = ${this.jsJson(values)};
        var note = "";
        // Print documents get CMYK unless keepRgb is set
        if (model === "RGB" && ${keepRgb ? 'false' : 'true'} && String(doc.documentPreferences.intent).indexOf("PRINT") === 0) {
          ${conversion === 'simple'
            ? `var conv = ${this.jsJson(model === 'RGB' ? this.rgbToCmyk(...values) : [0, 0, 0, 0])};
          note = " (RGB converted to CMYK with the simple formula, no colour profile - hues shift, prefer conversion profile)";`
            : `var conv = __cmsCmyk(doc, values);   // InDesign's colour engine: sRGB -> the document's CMYK profile
          note = " (RGB converted to CMYK with the document profile " + doc.cmykProfile + ")";`}
          values = conv; model = "CMYK";
        }
        var updated = existing.isValid;
        var color;
        if (updated) {
          color = existing;
        } else {
          color = doc.colors.add();
          color.name = ${this.jsStr(name)};
        }
        color.model = ${spotColor ? 'ColorModel.SPOT' : 'ColorModel.PROCESS'};
        color.space = (model === "CMYK") ? ColorSpace.CMYK : ColorSpace.RGB;
        color.colorValue = values;
        var out = [];
        for (var i = 0; i < color.colorValue.length; i++) out.push(__r(color.colorValue[i]));
        "Swatch " + ${this.jsStr(name)} + (updated ? " updated: " : " created: ") + model + " " + out.join(",") + (${spotColor ? 'true' : 'false'} ? " (spot)" : "") + note;
      `;

      const result = await this.executeInDesignScript(script);
      return this.formatResponse(result, "Create Color Swatch");
    },

    async applyColor(args) {
      const { swatchName, property = 'fill' } = args;
      if (!['fill', 'stroke'].includes(property)) throw new Error(`Invalid property: ${property} (use fill or stroke)`);
      const num = (v, label) => (v === undefined || v === null ? 'null' : this.jsNum(v, label));

      const script = `
        var doc = __requireDoc();
        var item = __resolve(doc, ${num(args.objectId, 'objectId')}, ${num(args.pageIndex, 'pageIndex')}, ${num(args.objectIndex, 'objectIndex')});
        var swatch = __swatch(doc, ${this.jsStr(swatchName)});
        item.${property === 'fill' ? 'fillColor' : 'strokeColor'} = swatch;
        "Colour " + ${this.jsStr(swatchName)} + " applied to ${property} of " + __describe(item);
      `;

      const result = await this.executeInDesignScript(script);
      return this.formatResponse(result, "Apply Color");
    },
  });

  const handlers = {
    create_paragraph_style: (args) => self.createParagraphStyle(args),
    modify_paragraph_style: (args) => self.modifyParagraphStyle(args),
    create_character_style: (args) => self.createCharacterStyle(args),
    modify_character_style: (args) => self.modifyCharacterStyle(args),
    create_object_style: (args) => self.createObjectStyle(args),
    modify_object_style: (args) => self.modifyObjectStyle(args),
    apply_paragraph_style: (args) => self.applyParagraphStyle(args),
    apply_object_style: (args) => self.applyObjectStyle(args),
    list_styles: (args) => self.listStyles(args),
    create_color_swatch: (args) => self.createColorSwatch(args),
    apply_color: (args) => self.applyColor(args),
  };

  return { definitions, handlers };
}
