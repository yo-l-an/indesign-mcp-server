// Document, pages and layers: open, create, save, close, page structure, layers, navigation, code and data merge.
//
// Moved out of index.js: each tool declares its schema, whether it modifies the document
// (`modifies`) and its handler in this one file. Handlers reach the tool context (run, respond,
// jsStr, jsNum, frameExpr…, lib/tool-context.js) through `this`.

import os from 'os';
import path from 'path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { has } from '../lib/tool-context.js';

// set_page_size / add_page anchor -> AnchorPoint
const PAGE_ANCHORS = {
  'top-left': 'TOP_LEFT_ANCHOR', top: 'TOP_CENTER_ANCHOR', 'top-right': 'TOP_RIGHT_ANCHOR',
  left: 'LEFT_CENTER_ANCHOR', center: 'CENTER_ANCHOR', right: 'RIGHT_CENTER_ANCHOR',
  'bottom-left': 'BOTTOM_LEFT_ANCHOR', bottom: 'BOTTOM_CENTER_ANCHOR', 'bottom-right': 'BOTTOM_RIGHT_ANCHOR',
};

// A document that was never saved, saved with no filePath, goes to this folder under its own name
const DEFAULT_SAVE_DIR = () => process.env.INDESIGN_DEFAULT_SAVE_DIR || path.join(os.homedir(), 'Documents');

export function createDocumentTools(ctx) {
  const definitions = [
    {
      name: 'get_document_info',
      modifies: false,
      description: 'Information about the active document: size in mm, pages (with page names), facing pages, bleed, slug, margins, colour intent/profiles, object counts. Swatch values only with includeSwatches (or use list_color_swatches).',
      inputSchema: { type: 'object', properties: { includeSwatches: { type: 'boolean', description: 'Also list every swatch with its values', default: false } } },
    },
    {
      name: 'create_document',
      modifies: false,
      paths: ['filePath'],
      overwrites: 'filePath',
      description: 'Create a new document (units: mm). Ask the user where to save it first and pass filePath: the document is saved there right away. Presets: A3, A4, A5, Letter, Legal, Custom. For Custom, width/height are in mm; an explicit orientation swaps them if needed (Landscape => width >= height, Portrait => height >= width); without orientation they are used as given.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'The .indd file to save the new document to (where the user asked)' },
          preset: { type: 'string', enum: ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Custom'], description: 'Page size preset', default: 'A4' },
          width: { type: 'number', description: 'Page width in mm (Custom only)' },
          height: { type: 'number', description: 'Page height in mm (Custom only)' },
          orientation: { type: 'string', enum: ['Portrait', 'Landscape'], description: 'Presets default to Portrait. For Custom, only applied when given.' },
          pages: { type: 'number', description: 'Number of pages', default: 1 },
          facingPages: { type: 'boolean', description: 'Enable facing pages', default: false },
          bleed: { type: 'number', description: 'Bleed on all sides in mm', default: 0 },
          slug: { type: 'number', description: 'Slug on all sides in mm', default: 0 },
          marginTop: { type: 'number', description: 'Top margin in mm', default: 20 },
          marginBottom: { type: 'number', description: 'Bottom margin in mm', default: 20 },
          marginLeft: { type: 'number', description: 'Left (inside) margin in mm', default: 20 },
          marginRight: { type: 'number', description: 'Right (outside) margin in mm', default: 20 },
        },
      },
    },
    {
      name: 'open_document',
      modifies: false,
      paths: ['filePath'],
      description: 'Open an existing InDesign document',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Path to the InDesign document (.indd)' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'save_document',
      modifies: false,
      paths: ['filePath'],
      description: 'Save a document (the active one, or the one named by "name"). Without filePath: a plain save; a document that was never saved ("Sans titre-1") goes to the Documents folder under its own name, and the result says where (tell the user). With filePath: Save As, the same document is renamed and stays open; the document\'s own file (same path) is just a plain save; overwriting a DIFFERENT existing file needs confirmDestructive. Saving to the file of another open document is refused.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Optional: path of the .indd file to save to (Save As)' },
          name: { type: 'string', description: 'Name of the document as shown by list_open_documents (default: the active document)' },
          confirmDestructive: { type: 'boolean', description: 'Required only to overwrite an existing file that is not the document\'s own file', default: false },
        },
      },
    },
    {
      name: 'close_document',
      modifies: false,
      description: 'Close a document (the active one, or the one named by "name"). Documents with unsaved changes require save=true or confirmDestructive=true.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Document name as shown by list_open_documents (default: active document)' },
          save: { type: 'boolean', description: 'Save before closing (a document that was never saved goes to the Documents folder, as with save_document)', default: false },
          confirmDestructive: { type: 'boolean', description: 'Required to discard unsaved changes', default: false },
        },
      },
    },
    {
      name: 'add_page',
      modifies: true,
      description: 'Add a new page to the document. width / height (mm) give the new page its own size (see set_page_size).',
      inputSchema: {
        type: 'object',
        properties: {
          position: { type: 'string', enum: ['before', 'after', 'end'], default: 'end' },
          pageIndex: { type: 'number', description: 'Reference page index (for before/after)' },
          masterPage: { type: 'string', description: 'Master page to apply' },
          width: { type: 'number', description: 'Width of the new page in mm (default: document size)' },
          height: { type: 'number', description: 'Height of the new page in mm (default: document size)' },
        },
      },
    },
    {
      name: 'set_page_size',
      modifies: true,
      description: 'Give pages their own size (mm), e.g. one page per web section of a different height. The page grows or shrinks from anchor (default top-left); objects keep their place on the page. pageIndexes: the pages (0-based); omit for every page. The document default size is unchanged.',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndexes: { type: 'array', items: { type: 'number' }, description: 'Pages to resize (0-based); omit for every page' },
          width: { type: 'number', description: 'New width in mm (default: unchanged)' },
          height: { type: 'number', description: 'New height in mm (default: unchanged)' },
          anchor: { type: 'string', enum: Object.keys(PAGE_ANCHORS), description: 'Point of the page that stays in place', default: 'top-left' },
        },
      },
    },
    {
      name: 'delete_page',
      modifies: true,
      destructive: 'deletes a page and everything on it',
      description: 'Delete a page from the document',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: 'Page index to delete' },
          confirmDestructive: { type: 'boolean', description: 'Must be true: the page and its content are deleted', default: false },
        },
        required: ['pageIndex'],
      },
    },
    {
      name: 'duplicate_page',
      modifies: true,
      description: 'Duplicate a page with all its content (position: before/after the source page, or end of the document)',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: 'Page index to duplicate' },
          position: { type: 'string', enum: ['before', 'after', 'end'], default: 'after' },
        },
        required: ['pageIndex'],
      },
    },
    {
      name: 'navigate_to_page',
      modifies: false,
      description: 'Navigate to a specific page',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: 'Page index to navigate to' },
        },
        required: ['pageIndex'],
      },
    },
    {
      name: 'create_layer',
      modifies: true,
      description: 'Create a new layer with a name, optional guide colour, visibility and lock state. Fails if the name is taken.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Layer name' },
          color: { type: 'string', description: 'Layer colour name, e.g. RED, BLUE, LIGHT_BLUE, GREEN, YELLOW (error if unknown)' },
          visible: { type: 'boolean', description: 'Layer visibility', default: true },
          locked: { type: 'boolean', description: 'Layer locked state', default: false },
        },
        required: ['name'],
      },
    },
    {
      name: 'set_active_layer',
      modifies: true,
      description: 'Set the active layer',
      inputSchema: {
        type: 'object',
        properties: {
          layerName: { type: 'string', description: 'Layer name to activate' },
        },
        required: ['layerName'],
      },
    },
    {
      name: 'list_layers',
      modifies: false,
      description: 'List all layers in the document, top of the stack first',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'move_layer',
      modifies: true,
      description: 'Change the stacking order of a layer: to the top or bottom of the stack, or directly above / below another layer. Layers higher in the stack paint over lower ones.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Layer to move' },
          position: { type: 'string', enum: ['top', 'bottom'], description: 'Top or bottom of the layer stack' },
          above: { type: 'string', description: 'Or: put it directly above this layer' },
          below: { type: 'string', description: 'Or: put it directly below this layer' },
        },
        required: ['name'],
      },
    },
    {
      name: 'move_to_layer',
      modifies: true,
      description: 'Move objects (by id) to another layer. They keep their page and position; on the target layer they sit above what is already there.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'number' }, description: 'Object ids' },
          layerName: { type: 'string', description: 'Target layer' },
        },
        required: ['ids', 'layerName'],
      },
    },
    {
      name: 'zoom_to_page',
      modifies: false,
      description: 'Zoom and fit page in view',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: 'Page index to zoom to' },
          fitOption: { type: 'string', enum: ['FIT_PAGE', 'FIT_SPREAD', 'ACTUAL_SIZE'], default: 'FIT_PAGE' },
        },
      },
    },
    {
      name: 'execute_indesign_code',
      modifies: false,
      description: '⚠️ Execute custom ExtendScript code in InDesign (REQUIRES INDESIGN_ALLOW_ARBITRARY_CODE=1)',
      inputSchema: {
        type: 'object',
        properties: {
          code: { 
            type: 'string', 
            description: 'ExtendScript/JavaScript code to execute in InDesign. WARNING: Can access filesystem, network, and system APIs!' 
          },
        },
        required: ['code'],
      },
    },
    {
      name: 'data_merge',
      modifies: true,
      paths: ['dataSourcePath', 'outputFolder'],
      overwrites: 'outputFolder',
      description: 'Merge the active document (which needs data field placeholders) with a CSV/TXT data source. Writes ONE merged file per format into outputFolder: <document>_merged.pdf and/or <document>_merged.indd',
      inputSchema: {
        type: 'object',
        properties: {
          dataSourcePath: { type: 'string', description: 'Path to CSV data source' },
          outputFolder: { type: 'string', description: 'Output folder (created if missing)' },
          fileFormat: { type: 'string', enum: ['INDD', 'PDF', 'BOTH'], default: 'PDF' },
          recordRange: { type: 'string', description: 'Records: "all", a single number ("3") or a range ("1-10")', default: 'all' },
          confirmDestructive: { type: 'boolean', description: 'Required only when the output folder already holds files', default: false },
        },
        required: ['dataSourcePath', 'outputFolder'],
      },
    },
  ];

  const self = Object.assign(Object.create(ctx), {
    async getDocumentInfo(args = {}) {
      const script = `
        var doc = __requireDoc();
        var dp = doc.documentPreferences;
        var mp = doc.marginPreferences;
        var intentName = String(dp.intent);
        // (ExtendScript mis-parses chained ternaries with ===, so use plain ifs)
        var intent = "Mobile";
        if (intentName.indexOf("PRINT") === 0) { intent = "Print"; }
        else if (intentName.indexOf("WEB") === 0) { intent = "Web"; }
        var info = "=== DOCUMENT INFORMATION ===\\n";
        info += "Name: " + doc.name + "\\n";
        info += "Pages: " + doc.pages.length + "\\n";
        info += "Width: " + __r(dp.pageWidth) + " mm\\n";
        info += "Height: " + __r(dp.pageHeight) + " mm\\n";
        info += "Facing Pages: " + dp.facingPages + "\\n";
        info += "Modified: " + doc.modified + "\\n";
        var filePath = "Unsaved";
        if (__hasFile(doc)) filePath = doc.fullName.fsName;
        else { try { if (doc.converted && doc.filePath) filePath = doc.filePath.fsName + "/" + doc.name + " (converted from an older InDesign version, not saved yet)"; } catch (e) {} }
        info += "File Path: " + filePath + "\\n";
        var pn = [];
        for (var q = 0; q < doc.pages.length; q++) pn.push(doc.pages[q].name);
        info += "Page names: " + (pn.length > 40 ? pn.slice(0, 20).join(", ") + " ... " + pn.slice(-10).join(", ") : pn.join(", ")) + "\\n";
        // Pages resized with set_page_size differ from the document size: list them
        var odd = [];
        for (var q2 = 0; q2 < doc.pages.length; q2++) {
          var qb = doc.pages[q2].bounds, qw = qb[3] - qb[1], qh = qb[2] - qb[0];
          if (Math.abs(qw - dp.pageWidth) > 0.01 || Math.abs(qh - dp.pageHeight) > 0.01) odd.push(doc.pages[q2].name + " " + __r(qw) + " x " + __r(qh));
        }
        if (odd.length) info += "Pages with their own size (mm): " + (odd.length > 20 ? odd.slice(0, 20).join(", ") + " ... (" + odd.length + ")" : odd.join(", ")) + "\\n";
        info += "\\n=== BLEED / SLUG (mm) ===\\n";
        info += "Bleed top/bottom/inside/outside: " + __r(dp.documentBleedTopOffset) + " / " + __r(dp.documentBleedBottomOffset) + " / " + __r(dp.documentBleedInsideOrLeftOffset) + " / " + __r(dp.documentBleedOutsideOrRightOffset) + "\\n";
        info += "Slug top/bottom/inside/outside: " + __r(dp.slugTopOffset) + " / " + __r(dp.slugBottomOffset) + " / " + __r(dp.slugInsideOrLeftOffset) + " / " + __r(dp.slugRightOrOutsideOffset) + "\\n";
        info += "\\n=== MARGINS (mm, document defaults) ===\\n";
        info += "Top: " + __r(mp.top) + "\\n";
        info += "Bottom: " + __r(mp.bottom) + "\\n";
        info += "Left: " + __r(mp.left) + "\\n";
        info += "Right: " + __r(mp.right) + "\\n";
        info += "\\n=== COLOUR ===\\n";
        info += "Intent: " + intent + "\\n";
        try { info += "CMYK profile: " + doc.cmykProfile + "\\n"; } catch (e) {}
        try { info += "RGB profile: " + doc.rgbProfile + "\\n"; } catch (e) {}
        info += "\\n=== CONTENT SUMMARY ===\\n";
        var totalTextFrames = 0, totalRects = 0, totalShapes = 0;
        for (var i = 0; i < doc.pages.length; i++) {
          totalTextFrames += doc.pages[i].textFrames.length;
          totalRects += doc.pages[i].rectangles.length;
          totalShapes += doc.pages[i].ovals.length + doc.pages[i].polygons.length;
        }
        info += "Text Frames: " + totalTextFrames + "\\n";
        info += "Rectangles (incl. image frames): " + totalRects + "\\n";
        info += "Ovals/Polygons: " + totalShapes + "\\n";
        info += "Layers: " + doc.layers.length + "\\n";
        info += "Swatches: " + doc.swatches.length + "\\n";
        ${args.includeSwatches ? '' : 'if (false) '}for (var s = 0; s < doc.swatches.length; s++) {
          var sw = doc.swatches[s].getElements()[0];
          var line = "  " + sw.name;
          try {
            if (sw.constructor.name === "Color") {
              line += " [" + String(sw.space) + " " + (String(sw.model) === "SPOT" ? "spot" : "process") + ": ";
              var cv = sw.colorValue, cvs = [];
              for (var c = 0; c < cv.length; c++) cvs.push(__r(cv[c]));
              line += cvs.join(",") + "]";
            }
          } catch (e) {}
          info += line + "\\n";
        }
        info;
      `;

      const result = await this.run(script);
      return this.respond(result, "Document Info");
    },

    async createDocument(args) {
      const {
        preset = 'A4',
        width,
        height,
        orientation,
        pages = 1,
        facingPages = false,
        bleed = 0,
        slug = 0,
        marginTop = 20,
        marginBottom = 20,
        marginLeft = 20,
        marginRight = 20,
        filePath,
      } = args;
      if (filePath && !/\.ind[dt]$/i.test(filePath)) throw new Error('filePath must end with .indd (or .indt for a template)');

      // Page sizes in mm (portrait)
      const presets = {
        A3: [297, 420],
        A4: [210, 297],
        A5: [148, 210],
        Letter: [215.9, 279.4],
        Legal: [215.9, 355.6],
      };

      if (orientation !== undefined && !['portrait', 'landscape'].includes(String(orientation).toLowerCase())) {
        throw new Error(`Invalid orientation: ${orientation} (use Portrait or Landscape)`);
      }
      const landscape = orientation !== undefined && String(orientation).toLowerCase() === 'landscape';
      const portrait = orientation !== undefined && !landscape;

      let pageWidth, pageHeight;
      if (preset === 'Custom') {
        if (width === undefined || height === undefined) {
          throw new Error('Custom preset requires width and height (in mm)');
        }
        pageWidth = this.jsNum(width, 'width');
        pageHeight = this.jsNum(height, 'height');
        // An explicit orientation is honoured by swapping; without one, width/height are final
        if ((landscape && pageWidth < pageHeight) || (portrait && pageWidth > pageHeight)) {
          [pageWidth, pageHeight] = [pageHeight, pageWidth];
        }
      } else if (presets[preset]) {
        [pageWidth, pageHeight] = presets[preset];
        if (landscape) {
          [pageWidth, pageHeight] = [pageHeight, pageWidth];
        }
      } else {
        throw new Error(`Unknown preset: ${preset} (use ${Object.keys(presets).join(', ')} or Custom)`);
      }

      const pageCount = Math.max(1, Math.floor(this.jsNum(pages, 'pages')));
      const bleedMm = this.jsNum(bleed, 'bleed');
      const slugMm = this.jsNum(slug, 'slug');
      const mTop = this.jsNum(marginTop, 'marginTop');
      const mBottom = this.jsNum(marginBottom, 'marginBottom');
      const mLeft = this.jsNum(marginLeft, 'marginLeft');
      const mRight = this.jsNum(marginRight, 'marginRight');

      const script = `
        var doc = app.documents.add();
      
        // Millimetres, and coordinates relative to each page (origin = top-left of the trim area)
        doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.MILLIMETERS;
        doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
      
        // Page size, page count, facing pages
        doc.documentPreferences.pageWidth = "${pageWidth}mm";
        doc.documentPreferences.pageHeight = "${pageHeight}mm";
        doc.documentPreferences.facingPages = ${facingPages ? 'true' : 'false'};
        doc.documentPreferences.pagesPerDocument = ${pageCount};
      
        // Bleed and slug
        doc.documentPreferences.documentBleedUniformSize = false;
        doc.documentPreferences.documentBleedTopOffset = "${bleedMm}mm";
        doc.documentPreferences.documentBleedBottomOffset = "${bleedMm}mm";
        doc.documentPreferences.documentBleedInsideOrLeftOffset = "${bleedMm}mm";
        doc.documentPreferences.documentBleedOutsideOrRightOffset = "${bleedMm}mm";
        doc.documentPreferences.documentSlugUniformSize = false;
        doc.documentPreferences.slugTopOffset = "${slugMm}mm";
        doc.documentPreferences.slugBottomOffset = "${slugMm}mm";
        doc.documentPreferences.slugInsideOrLeftOffset = "${slugMm}mm";
        doc.documentPreferences.slugRightOrOutsideOffset = "${slugMm}mm";
      
        // Margins: set on the document defaults, the master pages and the existing pages
        doc.marginPreferences.top = "${mTop}mm";
        doc.marginPreferences.bottom = "${mBottom}mm";
        doc.marginPreferences.left = "${mLeft}mm";
        doc.marginPreferences.right = "${mRight}mm";
        var targets = [];
        for (var m = 0; m < doc.masterSpreads.length; m++) {
          for (var mp = 0; mp < doc.masterSpreads[m].pages.length; mp++) targets.push(doc.masterSpreads[m].pages[mp]);
        }
        for (var pg = 0; pg < doc.pages.length; pg++) targets.push(doc.pages[pg]);
        for (var t = 0; t < targets.length; t++) {
          targets[t].marginPreferences.top = "${mTop}mm";
          targets[t].marginPreferences.bottom = "${mBottom}mm";
          targets[t].marginPreferences.left = "${mLeft}mm";
          targets[t].marginPreferences.right = "${mRight}mm";
        }
      
        ${filePath ? `var target = File(${this.jsStr(filePath)});
        if (!target.parent.exists) target.parent.create();
        doc.save(target);
        var saved = "saved as " + doc.fullName.fsName;` : `var saved = "not saved yet: ask the user where to save it, then save_document({ filePath })";`}
        "Document created: " + doc.name + " - " + ${this.jsStr(preset)} + " (" + __r(doc.documentPreferences.pageWidth) + " x " + __r(doc.documentPreferences.pageHeight) + " mm), " +
        doc.pages.length + " pages, " + (doc.documentPreferences.facingPages ? "facing pages" : "single pages") + "; " + saved + "\\nDOCID " + doc.id;
      `;

      // A document built in this session gets no automatic backup / snapshot (lib: review-tools autoSnapshot)
      const [result, docId] = String(await this.run(script)).split('\nDOCID ');
      if (docId && this.workflow?.createdDocIds) this.workflow.createdDocIds.add(Number(docId));
      return this.respond(result, "Create Document");
    },

    async openDocument(args) {
      const { filePath } = args;
    
      const validatedPath = filePath;
    
      const script = `
        try {
          var file = File(${this.jsStr(validatedPath)});
          if (!file.exists) {
            throw new Error("File not found: " + ${this.jsStr(validatedPath)});
          } else {
            var doc = app.open(file);
            "Document opened: " + doc.name + " (" + doc.pages.length + " pages)";
          }
        } catch (e) {
          throw new Error("Error opening document: " + e.message);
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Open Document");
    },

    // ES3 that saves the never-saved document \`doc\` into the default folder under a free name and
    // sets __untitledMessage. A converted document keeps asking for a filePath: saving it next to
    // the original replaces the old-version file, so that is the user's call.
    untitledSaveScript() {
      const dir = this.resolvePath(DEFAULT_SAVE_DIR()) + path.sep;
      return `
            if (doc.converted) throw new Error("Document " + doc.name + " was converted from an older InDesign version: ask the user which file name to use, then pass filePath.");
            var __oldName = doc.name;
            var __base = __oldName.replace(/\\.ind[dt]$/i, "").replace(/[\\/:]/g, "-");
            var __saved = File(${this.jsStr(dir)} + __base + ".indd");
            for (var __n = 2; __saved.exists; __n++) __saved = File(${this.jsStr(dir)} + __base + "-" + __n + ".indd");
            if (!__saved.parent.exists) __saved.parent.create();
            doc.save(__saved);
            var __untitledMessage = "Document " + __oldName + " had never been saved: saved to " + __saved.fsName + " (default folder, no location was given). Tell the user, and ask whether to move it: save_document({ filePath }) saves it elsewhere (this copy stays where it is).";`;
    },

    async saveDocument(args) {
      const { filePath, name, confirmDestructive = false } = args;

      // filePath is already resolved and checked by the policy (lib/policy.js)
      const validatedPath = filePath || null;
      if (validatedPath && !/\.ind[dt]$/i.test(validatedPath)) throw new Error('filePath must end with .indd (or .indt for a template)');

      const script = `
        var doc = ${name ? `app.documents.itemByName(${this.jsStr(name)})` : '__requireDoc()'};
        ${name ? `if (!doc.isValid) throw new Error("Document not found: " + ${this.jsStr(name)});` : ''}
        var hasFile = __hasFile(doc);
        ${validatedPath ? `
          var target = File(${this.jsStr(validatedPath)});
          if (hasFile && doc.fullName.fsName === target.fsName) {
            // Save As onto its own file: an ordinary save (InDesign would refuse to replace an open file)
            doc.save();
            "Document saved: " + doc.name + " (" + doc.fullName.fsName + "; filePath is the file the document already has, so this was a plain save)";
          } else {
            for (var i = 0; i < app.documents.length; i++) {
              var other = app.documents[i];
              if (other.id === doc.id || !__hasFile(other)) continue;
              if (other.fullName.fsName === target.fsName) {
                throw new Error("The file " + target.fsName + " is already open in the document " + other.name + ". Close that document first, or choose another file name.");
              }
            }
            if (target.exists && !${confirmDestructive ? 'true' : 'false'}) {
              throw new Error("The file " + target.fsName + " already exists. Pass confirmDestructive: true to overwrite it.");
            }
            if (!target.parent.exists) target.parent.create();
            var oldName = doc.name;
            doc.save(target);
            "Document saved as: " + target.fsName + " (Save As: the document " + oldName + " is now named " + doc.name + "; " + app.documents.length + " document(s) open)";
          }
        ` : `
          if (!hasFile) {
            ${this.untitledSaveScript()}
            __untitledMessage;
          } else {
            doc.save();
            "Document saved: " + doc.name + " (" + doc.fullName.fsName + ")";
          }
        `}
      `;

      const result = await this.run(script);
      return this.respond(result, "Save Document");
    },

    async closeDocument(args) {
      const { name, save = false, confirmDestructive = false } = args;

      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open to close");
        } else {
          var doc = ${name ? `app.documents.itemByName(${this.jsStr(name)})` : 'app.activeDocument'};
          if (!doc.isValid) {
            throw new Error("Document not found: " + ${this.jsStr(name || '')});
          } else {
            var docName = doc.name;
            if (${save ? 'true' : 'false'}) {
              if (!__hasFile(doc)) {
                ${this.untitledSaveScript()}
                doc.close(SaveOptions.NO);
                __untitledMessage + " The document is closed.";
              } else {
                doc.close(SaveOptions.YES);
                "Document saved and closed: " + docName;
              }
            } else if (doc.modified && !${confirmDestructive ? 'true' : 'false'}) {
              throw new Error("Document " + docName + " has unsaved changes. Pass save=true, or confirmDestructive=true to discard them.");
            } else {
              doc.close(SaveOptions.NO);
              "Document closed: " + docName;
            }
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Close Document");
    },

    // Script lines that resize `pg` (a Page) to width x height mm, keeping `anchor` in place
    pageResizeLines(width, height, anchor = 'top-left') {
      const ref = PAGE_ANCHORS[anchor];
      if (!ref) throw new Error(`Invalid anchor: ${anchor} (use ${Object.keys(PAGE_ANCHORS).join(', ')})`);
      const size = (v, label) => {
        const n = this.jsNum(v, label);
        if (n < 1 || n > 5486) throw new Error(`${label} must be 1-5486 mm`);
        return n;
      };
      const w = has(width) ? size(width, 'width') : null;
      const h = has(height) ? size(height, 'height') : null;
      if (w === null && h === null) throw new Error('Give width and/or height (mm)');
      return `
          var __pb = pg.bounds;
          var __w = ${w === null ? '__pb[3] - __pb[1]' : w}, __h = ${h === null ? '__pb[2] - __pb[0]' : h};
          // resize() takes points in the page's own coordinates; objects stay where they are
          pg.layoutRule = LayoutRuleOptions.OFF;
          pg.resize(CoordinateSpaces.INNER_COORDINATES, AnchorPoint.${ref}, ResizeMethods.REPLACING_CURRENT_DIMENSIONS_WITH, [__w * 72 / 25.4, __h * 72 / 25.4]);
      `;
    },

    async setPageSize(args) {
      const resize = this.pageResizeLines(args.width, args.height, args.anchor || 'top-left');
      const indexes = Array.isArray(args.pageIndexes) && args.pageIndexes.length ? args.pageIndexes.map((v) => this.jsNum(v, 'pageIndexes')) : null;
      const script = `
        var doc = __requireDoc();
        var list = [];
        ${indexes ? `var idx = ${this.jsJson(indexes)}; for (var i = 0; i < idx.length; i++) list.push(__page(doc, idx[i]));` : 'for (var i = 0; i < doc.pages.length; i++) list.push(doc.pages[i]);'}
        var out = [];
        for (var k = 0; k < list.length; k++) {
          var pg = list[k];
          ${resize}
          var nb = pg.bounds;
          out.push("page " + pg.name + " (pageIndex " + pg.documentOffset + "): " + __r(nb[3] - nb[1]) + " x " + __r(nb[2] - nb[0]) + " mm");
        }
        "Page size set: " + out.join("; ");
      `;
      return this.respond(await this.run(script), 'Set Page Size');
    },

    async addPage(args) {
      const { position = 'end', pageIndex, masterPage } = args;
      const resize = has(args.width) || has(args.height) ? this.pageResizeLines(args.width, args.height) : '';
    
      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          try {
            var newPage;
          
            ${position === 'end' ? `
              newPage = doc.pages.add();
            ` : `
              var refPage = doc.pages[${pageIndex || 0}];
              newPage = doc.pages.add(${position === 'before' ? 'LocationOptions.BEFORE' : 'LocationOptions.AFTER'}, refPage);
            `}
          
            ${masterPage ? `
              var master = doc.masterSpreads.itemByName(${this.jsStr(masterPage)});
              if (master.isValid) {
                newPage.appliedMaster = master;
              }
            ` : ''}
          
            ${resize ? `var pg = newPage; ${resize}` : ''}
            var npb = newPage.bounds;
            "Page added at position " + (newPage.documentOffset + 1) + " (" + __r(npb[3] - npb[1]) + " x " + __r(npb[2] - npb[0]) + " mm). Total pages: " + doc.pages.length;
          } catch (e) {
            throw new Error("Error adding page: " + e.message);
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Add Page");
    },

    async deletePage(args) {
      const { pageIndex } = args;
    
      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          try {
            if (${pageIndex} >= doc.pages.length || ${pageIndex} < 0) {
              throw new Error("Invalid page index: ${pageIndex}. Document has " + doc.pages.length + " pages.");
            } else if (doc.pages.length === 1) {
              throw new Error("Cannot delete the last page in the document.");
            } else {
              var pageToDelete = doc.pages[${pageIndex}];
              pageToDelete.remove();
              "Page " + (${pageIndex} + 1) + " deleted. Remaining pages: " + doc.pages.length;
            }
          } catch (e) {
            throw new Error("Error deleting page: " + e.message);
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Delete Page");
    },

    async duplicatePage(args) {
      const { pageIndex, position = 'after' } = args;
      if (!['before', 'after', 'end'].includes(position)) throw new Error(`Invalid position: ${position} (use before, after or end)`);
      const idx = this.jsNum(pageIndex, 'pageIndex');
      const at = position === 'end' ? 'LocationOptions.AT_END' : position === 'before' ? 'LocationOptions.BEFORE' : 'LocationOptions.AFTER';

      const script = `
        var doc = __requireDoc();
        var source = __page(doc, ${idx});
        // Page.duplicate copies the page with all its content (each object exactly once, groups intact)
        var copy = ${position === 'end' ? `source.duplicate(${at})` : `source.duplicate(${at}, source)`};
        "Page " + (${idx} + 1) + " duplicated. New page position: " + (copy.documentOffset + 1) + " (" + copy.allPageItems.length + " objects). Total pages: " + doc.pages.length;
      `;

      const result = await this.run(script);
      return this.respond(result, "Duplicate Page");
    },

    async navigateToPage(args) {
      const { pageIndex } = args;
    
      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          try {
            if (${pageIndex} >= doc.pages.length || ${pageIndex} < 0) {
              throw new Error("Invalid page index: ${pageIndex}. Document has " + doc.pages.length + " pages.");
            } else {
              app.activeWindow.activePage = doc.pages[${pageIndex}];
              "Navigated to page " + (${pageIndex} + 1);
            }
          } catch (e) {
            throw new Error("Error navigating to page: " + e.message);
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Navigate to Page");
    },

    async executeInDesignCode(args) {
      const code = (typeof args === 'string') ? args : args.code;
    
      // Security: Check if arbitrary code execution is allowed
      const allowArbitraryCode = process.env.INDESIGN_ALLOW_ARBITRARY_CODE;
      if (!allowArbitraryCode || allowArbitraryCode === '0' || allowArbitraryCode.toLowerCase() === 'false') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Arbitrary code execution is disabled for security reasons.

  To enable this feature, set the environment variable:
  INDESIGN_ALLOW_ARBITRARY_CODE=1

  ⚠️  WARNING: This allows execution of any ExtendScript code, which can:
  - Access the file system
  - Make network connections  
  - Execute system commands via InDesign APIs
  - Read/modify any InDesign document data

  Only enable this if you trust all users and understand the security implications.

  Usage: INDESIGN_ALLOW_ARBITRARY_CODE=1 node index.js`
        );
      }
    
      // User has explicitly enabled arbitrary code execution
      const result = await this.run(code);
      return this.respond(result, "Execute Custom Code");
    },

    async createLayer(args) {
      const { name, color, visible = true, locked = false } = args;

      const script = `
        var doc = __requireDoc();
        if (doc.layers.itemByName(${this.jsStr(name)}).isValid) throw new Error("Layer already exists: " + ${this.jsStr(name)});
        var layer = doc.layers.add();
        try {
          layer.name = ${this.jsStr(name)};
          layer.visible = ${visible ? 'true' : 'false'};
          layer.locked = ${locked ? 'true' : 'false'};
          ${color ? `
            var colour;
            try { colour = UIColors[${this.jsStr(String(color).toUpperCase())}]; } catch (ce) { colour = undefined; }
            if (colour === undefined) throw new Error("Unknown layer colour: " + ${this.jsStr(color)} + " (examples: RED, BLUE, LIGHT_BLUE, GREEN, YELLOW)");
            layer.layerColor = colour;
          ` : ''}
        } catch (e) {
          layer.remove();
          throw e;
        }
        "Layer " + ${this.jsStr(name)} + " created";
      `;

      const result = await this.run(script);
      return this.respond(result, "Create Layer");
    },

    async setActiveLayer(args) {
      const { layerName } = args;

      const script = `
        var doc = __requireDoc();
        var layer = doc.layers.itemByName(${this.jsStr(layerName)});
        if (!layer.isValid) throw new Error("Layer not found: " + ${this.jsStr(layerName)});
        doc.activeLayer = layer;
        "Active layer set to: " + ${this.jsStr(layerName)};
      `;

      const result = await this.run(script);
      return this.respond(result, "Set Active Layer");
    },

    async moveLayer(args) {
      const { name, position, above, below } = args;
      const targets = [position, above, below].filter((v) => v !== undefined && v !== null);
      if (targets.length !== 1) throw new Error('Give exactly one of position, above or below');
      if (position !== undefined && position !== 'top' && position !== 'bottom') {
        throw new Error(`position must be "top" or "bottom" (got ${JSON.stringify(position)})`);
      }

      const script = `
        var doc = __requireDoc();
        var layer = doc.layers.itemByName(${this.jsStr(name)});
        if (!layer.isValid) throw new Error("Layer not found: " + ${this.jsStr(name)});
        ${position !== undefined ? `
          layer.move(${position === 'top' ? 'LocationOptions.AT_BEGINNING' : 'LocationOptions.AT_END'});
        ` : `
          var ref = doc.layers.itemByName(${this.jsStr(above ?? below)});
          if (!ref.isValid) throw new Error("Layer not found: " + ${this.jsStr(above ?? below)});
          if (ref.id === layer.id) throw new Error("A layer cannot be moved relative to itself");
          layer.move(${above !== undefined ? 'LocationOptions.BEFORE' : 'LocationOptions.AFTER'}, ref);
        `}
        var order = [];
        for (var i = 0; i < doc.layers.length; i++) order.push(doc.layers[i].name);
        "Layer " + ${this.jsStr(name)} + " moved. Stack (top first): " + order.join(" > ");
      `;

      const result = await this.run(script);
      return this.respond(result, "Move Layer");
    },

    async moveToLayer(args) {
      const { ids, layerName } = args;
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids must be a non-empty array of object ids');
      const idList = ids.map((id) => this.jsNum(id, 'ids'));

      const script = `
        var doc = __requireDoc();
        var layer = doc.layers.itemByName(${this.jsStr(layerName)});
        if (!layer.isValid) throw new Error("Layer not found: " + ${this.jsStr(layerName)});
        if (layer.locked) throw new Error("Layer is locked: " + ${this.jsStr(layerName)});
        var ids = [${idList.join(', ')}];
        var items = [];
        for (var i = 0; i < ids.length; i++) {
          var it = __findById(doc, ids[i]);
          if (!it) throw new Error("No object with id " + ids[i] + " in the active document");
          items.push(it);
        }
        var moved = [];
        for (var j = 0; j < items.length; j++) {
          if (items[j].itemLayer.locked) throw new Error("Object " + items[j].id + " is on a locked layer: " + items[j].itemLayer.name);
          items[j].itemLayer = layer;
          moved.push(items[j].id);
        }
        moved.length + " object(s) moved to layer " + ${this.jsStr(layerName)} + ": " + moved.join(", ");
      `;

      const result = await this.run(script);
      return this.respond(result, "Move To Layer");
    },

    async listLayers() {
      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          var result = "=== DOCUMENT LAYERS ===\\n\\n";
        
          for (var i = 0; i < doc.layers.length; i++) {
            var layer = doc.layers[i];
            result += "• " + layer.name;
            result += " (Visible: " + layer.visible + ", Locked: " + layer.locked + ")";
            if (layer === doc.activeLayer) {
              result += " [ACTIVE]";
            }
            result += "\\n";
          }
        
          result;
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "List Layers");
    },

    async zoomToPage(args) {
      const { pageIndex, fitOption = 'FIT_PAGE' } = args;
      const zoom = { FIT_PAGE: 'FIT_PAGE', FIT_SPREAD: 'FIT_SPREAD', ACTUAL_SIZE: 'ACTUAL_SIZE' }[fitOption];
      if (!zoom) throw new Error(`Invalid fitOption: ${fitOption} (use FIT_PAGE, FIT_SPREAD or ACTUAL_SIZE)`);

      const script = `
        var doc = __requireDoc();
        ${pageIndex !== undefined ? `app.activeWindow.activePage = __page(doc, ${this.jsNum(pageIndex, 'pageIndex')});` : ''}
        app.activeWindow.zoom(ZoomOptions.${zoom});
        "Zoom applied: ${zoom}${pageIndex !== undefined ? ` on page ${this.jsNum(pageIndex, 'pageIndex') + 1}` : ''}";
      `;

      const result = await this.run(script);
      return this.respond(result, "Zoom to Page");
    },

    async dataMerge(args) {
      const { dataSourcePath, outputFolder, fileFormat = 'PDF', recordRange = 'all' } = args;

      // both paths are already resolved and checked by the policy (lib/policy.js)
      const validatedDataSource = dataSourcePath;
      const validatedOutputFolder = outputFolder;
      if (!['PDF', 'INDD', 'BOTH'].includes(fileFormat)) throw new Error(`Invalid fileFormat: ${fileFormat} (use PDF, INDD or BOTH)`);

      const range = String(recordRange).trim().toLowerCase();
      let selection;
      if (range === 'all') selection = { mode: 'ALL_RECORDS' };
      else if (/^\d+$/.test(range)) selection = { mode: 'ONE_RECORD', number: Number(range) };
      else if (/^\d+\s*-\s*\d+$/.test(range)) selection = { mode: 'RANGE', range: range.replace(/\s+/g, '') };
      else throw new Error(`Invalid recordRange: ${recordRange} (use "all", "3" or "1-10")`);

      const script = `
        var doc = __requireDoc();
        var source = File(${this.jsStr(validatedDataSource)});
        if (!source.exists) throw new Error("Data source file not found: " + source.fsName);
        var outDir = Folder(${this.jsStr(validatedOutputFolder)});
        if (!outDir.exists && !outDir.create()) throw new Error("Cannot create folder: " + outDir.fsName);
      
        var dm = doc.dataMergeProperties;
        dm.selectDataSource(source);
        var prefs = dm.dataMergePreferences;
        prefs.recordSelection = RecordSelection.${selection.mode};
        ${selection.number !== undefined ? `prefs.recordNumber = ${selection.number};` : ''}
        ${selection.range !== undefined ? `prefs.recordRange = ${this.jsStr(selection.range)};` : ''}
      
        var base = doc.name.replace(/\\.indd$/i, "") + "_merged";
        var written = [];
        ${fileFormat === 'PDF' || fileFormat === 'BOTH' ? `
          var pdf = File(outDir.fsName + "/" + base + ".pdf");
          dm.exportFile(pdf);
          if (!pdf.exists) throw new Error("Data merge did not create " + pdf.fsName);
          written.push(pdf.fsName);
        ` : ''}
        ${fileFormat === 'INDD' || fileFormat === 'BOTH' ? `
          dm.mergeRecords();
          var merged = app.activeDocument;
          var indd = File(outDir.fsName + "/" + base + ".indd");
          merged.save(indd);
          merged.close(SaveOptions.NO);
          app.activeDocument = doc;
          if (!indd.exists) throw new Error("Data merge did not create " + indd.fsName);
          written.push(indd.fsName);
        ` : ''}
        "Data merge completed (records: ${selection.mode === 'ALL_RECORDS' ? 'all' : range}). Files written:\\n" + written.join("\\n");
      `;

      const result = await this.run(script);
      return this.respond(result, "Data Merge");
    },
  });

  const handlers = {
    get_document_info: (args) => self.getDocumentInfo(args),
    create_document: (args) => self.createDocument(args),
    open_document: (args) => self.openDocument(args),
    save_document: (args) => self.saveDocument(args),
    close_document: (args) => self.closeDocument(args),
    add_page: (args) => self.addPage(args),
    set_page_size: (args) => self.setPageSize(args),
    delete_page: (args) => self.deletePage(args),
    duplicate_page: (args) => self.duplicatePage(args),
    navigate_to_page: (args) => self.navigateToPage(args),
    create_layer: (args) => self.createLayer(args),
    set_active_layer: (args) => self.setActiveLayer(args),
    move_layer: (args) => self.moveLayer(args),
    move_to_layer: (args) => self.moveToLayer(args),
    list_layers: () => self.listLayers(),
    zoom_to_page: (args) => self.zoomToPage(args),
    execute_indesign_code: (args) => self.executeInDesignCode(args.code),
    data_merge: (args) => self.dataMerge(args),
  };

  return { definitions, handlers };
}
