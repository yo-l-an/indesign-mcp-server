// Output: PDF, images, EPUB, package, preflight.
//
// Moved out of index.js: each tool declares its schema, whether it modifies the document
// (`modifies`) and its handler in this one file. Handlers reach the tool context (run, respond,
// jsStr, jsNum, frameExpr…, lib/tool-context.js) through `this`.

import { has } from '../lib/tool-context.js';

export function createExportTools(ctx) {
  const definitions = [
    {
      name: 'export_pdf',
      modifies: false,
      paths: ['filePath'],
      overwrites: 'filePath',
      description: 'Export the active document as PDF. preset: Print/HighQualityPrint = [High Quality Print], Web/SmallestFileSize = [Smallest File Size], PressQuality = [Press Quality], PDFX1a/PDFX3/PDFX4 = the PDF/X presets, or the exact name of any PDF preset in InDesign. includeBleed uses the document bleed; includeSlug the slug. Overwriting an existing file needs confirmDestructive.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Output PDF file path' },
          preset: { type: 'string', description: 'Preset alias or exact PDF preset name', default: 'HighQualityPrint' },
          pageRange: { type: 'string', description: 'Pages, e.g. "1", "2-3", "1,3-5" or "all"', default: 'all' },
          layout: { type: 'string', description: 'Only the pages of this alternate layout (pageRange then counts within it: "1-2" = its first two pages)' },
          includeBleed: { type: 'boolean', description: 'Use the document bleed', default: false },
          includeSlug: { type: 'boolean', description: 'Include the slug area', default: false },
          confirmDestructive: { type: 'boolean', description: 'Required only when the file already exists (it is overwritten)', default: false },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'export_images',
      modifies: false,
      paths: ['folderPath'],
      overwrites: 'folderPath',
      description: 'Export pages as PNG or JPEG, one file per page: <folder>/<documentname>_page<N>.<ext>. The folder is created if missing. Returns the list of files written.',
      inputSchema: {
        type: 'object',
        properties: {
          folderPath: { type: 'string', description: 'Output folder path' },
          format: { type: 'string', enum: ['PNG', 'JPEG'], default: 'PNG' },
          resolution: { type: 'number', description: 'Export resolution in dpi (e.g. 72, 100, 300)', default: 300 },
          pageRange: { type: 'string', description: 'Pages, e.g. "1", "2-3", "1,3-5" or "all"', default: 'all' },
          layout: { type: 'string', description: 'Only the pages of this alternate layout (pageRange then counts within it)' },
          includeBleed: { type: 'boolean', description: 'Include the document bleed', default: false },
          confirmDestructive: { type: 'boolean', description: 'Required only when the folder already holds files', default: false },
        },
        required: ['folderPath'],
      },
    },
    {
      name: 'export_epub',
      modifies: false,
      paths: ['filePath'],
      overwrites: 'filePath',
      description: 'Export document as EPUB',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Output EPUB file path' },
          version: { type: 'string', enum: ['EPUB2', 'EPUB3'], default: 'EPUB3' },
          imageFormat: { type: 'string', enum: ['AUTOMATIC', 'PNG', 'JPEG', 'GIF'], description: 'Image conversion', default: 'AUTOMATIC' },
          confirmDestructive: { type: 'boolean', description: 'Required only when the file already exists (it is overwritten)', default: false },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'package_document',
      modifies: false,
      paths: ['folderPath'],
      overwrites: 'folderPath',
      description: 'Package document for print production',
      inputSchema: {
        type: 'object',
        properties: {
          folderPath: { type: 'string', description: 'Output folder path' },
          includeLinkedFiles: { type: 'boolean', description: 'Include linked files', default: true },
          includeFonts: { type: 'boolean', description: 'Include fonts', default: true },
          createReport: { type: 'boolean', description: 'Create packaging report', default: true },
          confirmDestructive: { type: 'boolean', description: 'Required only when the folder already holds files', default: false },
        },
        required: ['folderPath'],
      },
    },
    {
      name: 'preflight_document',
      modifies: false,
      description: 'Run preflight check on the document',
      inputSchema: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'Preflight profile name' },
          scope: { type: 'string', enum: ['document', 'selection'], default: 'document' },
        },
      },
    },
  ];

  const self = Object.assign(Object.create(ctx), {
    // "1-3,5" / "all" -> array of 1-based page numbers, or null for all pages
    parsePageRange(pageRange) {
      if (pageRange === undefined || pageRange === null || String(pageRange).trim().toLowerCase() === 'all') return null;
      const pages = [];
      for (const part of String(pageRange).split(',')) {
        const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!m) throw new Error(`Invalid pageRange: ${pageRange} (use e.g. "1", "2-3", "1,3-5" or "all")`);
        const from = Number(m[1]);
        const to = m[2] ? Number(m[2]) : from;
        if (from < 1 || to < from) throw new Error(`Invalid pageRange: ${pageRange}`);
        for (let i = from; i <= to; i++) pages.push(i);
      }
      return pages;
    },

    // pageRange within an alternate layout -> 1-based positions in the document
    async layoutPositions(layout, pageRange) {
      const out = String(await this.run(`
        var doc = __requireDoc();
        var name = ${this.jsStr(layout)}, pos = [], names = {};
        for (var i = 0; i < doc.pages.length; i++) {
          var l = "";
          try { l = doc.pages[i].appliedAlternateLayout.alternateLayout; } catch (e) {}
          names[l] = 1;
          if (l === name) pos.push(i + 1);
        }
        if (!pos.length) { var ls = []; for (var k in names) ls.push(k); throw new Error("Layout not found: " + name + ". Layouts: " + ls.join(", ")); }
        pos.join(",");
      `));
      const all = out.split(',').map(Number);
      const wanted = this.parsePageRange(pageRange);
      if (!wanted) return all;
      return wanted.map((k) => {
        if (k > all.length) throw new Error(`Layout ${layout} has ${all.length} pages (pageRange ${pageRange})`);
        return all[k - 1];
      });
    },

    // [1,2,3,5] -> "+1-+3,+5"
    absoluteRange(positions) {
      const parts = [];
      let start = positions[0], prev = positions[0];
      for (const n of [...positions.slice(1), null]) {
        if (n !== null && n === prev + 1) { prev = n; continue; }
        parts.push(start === prev ? `+${start}` : `+${start}-+${prev}`);
        start = prev = n;
      }
      return parts.join(',');
    },

    async exportPDF(args) {
      const { filePath, preset = 'HighQualityPrint', pageRange = 'all', includeBleed = false, includeSlug = false } = args;

      const validatedPath = filePath;
      this.parsePageRange(pageRange); // validate early

      const aliases = {
        Print: '[High Quality Print]',
        HighQualityPrint: '[High Quality Print]',
        PressQuality: '[Press Quality]',
        Web: '[Smallest File Size]',
        SmallestFileSize: '[Smallest File Size]',
        PDFX1a: '[PDF/X-1a:2001]',
        PDFX3: '[PDF/X-3:2002]',
        PDFX4: '[PDF/X-4:2008]',
      };
      const presetName = aliases[preset] || preset;
      // Localised InDesign versions translate these three built-in preset names ("[Qualité supérieure]" ...),
      // so when the English name is missing they are recognised by their settings instead
      const fingerprints = {
        '[High Quality Print]': 'p.colorBitmapSamplingDPI >= 250 && p.pdfColorSpace === PDFColorSpace.UNCHANGED_COLOR_SPACE',
        '[Press Quality]': 'p.colorBitmapSamplingDPI >= 250 && p.pdfColorSpace === PDFColorSpace.REPURPOSE_CMYK',
        '[Smallest File Size]': 'p.colorBitmapSamplingDPI < 200',
      };
      const fingerprint = fingerprints[presetName];
      // Page numbers are positions in the document (1 = first page); they are sent to InDesign as absolute
      // page numbers ("+2-+3"), so custom numbering, sections and repeated page names cannot change the meaning.
      const positions = has(args.layout) ? await this.layoutPositions(args.layout, pageRange) : this.parsePageRange(pageRange);
      const rangeString = positions === null ? '' : this.absoluteRange(positions);

      const script = `
        var doc = __requireDoc();
        var base = app.pdfExportPresets.itemByName(${this.jsStr(presetName)});
        ${fingerprint ? `if (!base.isValid) {
          for (var j = 0; j < app.pdfExportPresets.length; j++) {
            var p = app.pdfExportPresets[j];
            if (p.name.charAt(0) !== "[" || p.standardsCompliance !== PDFXStandards.NONE) continue;
            if (${fingerprint}) { base = p; break; }
          }
        }` : ''}
        if (!base.isValid) {
          var names = [];
          for (var i = 0; i < app.pdfExportPresets.length; i++) names.push(app.pdfExportPresets[i].name);
          throw new Error("PDF preset not found: " + ${this.jsStr(presetName)} + ". Available: " + names.join(", "));
        }
      
        // A preset overrides the export preferences (including bleed and slug), so export with a
        // temporary copy of it that carries the bleed/slug settings. Page range is a preference.
        var TMP = "__indesign_mcp_tmp__";
        var old = app.pdfExportPresets.itemByName(TMP);
        if (old.isValid) old.remove();
        var tmp = app.pdfExportPresets.add({ name: TMP });
        var pdfFile = File(${this.jsStr(validatedPath)});
        if (!pdfFile.parent.exists) pdfFile.parent.create();
        try {
          tmp.properties = base.properties;
          tmp.name = TMP;
          tmp.useDocumentBleedWithPDF = ${includeBleed ? 'true' : 'false'};
          tmp.includeSlugWithPDF = ${includeSlug ? 'true' : 'false'};
          ${rangeString ? `app.pdfExportPreferences.pageRange = ${this.jsStr(rangeString)};` : 'app.pdfExportPreferences.pageRange = PageRange.ALL_PAGES;'}
          doc.exportFile(ExportFormat.PDF_TYPE, pdfFile, false, tmp);
        } finally {
          try { tmp.remove(); } catch (e) {}
        }
        if (!pdfFile.exists) throw new Error("PDF export did not create the file");
        "PDF exported: " + pdfFile.fsName + " (requested preset " + ${this.jsStr(preset)} + ", effective preset " + (base.name === ${this.jsStr(presetName)} ? base.name : ${this.jsStr(presetName)} + " = " + base.name) + ", pages " + ${this.jsStr(positions === null ? 'all' : (has(args.layout) ? `layout ${args.layout}, document positions ` + this.absoluteRange(positions).replace(/\+/g, '') : String(pageRange).replace(/\s+/g, '')))} + ", bleed " + ${includeBleed ? '"included"' : '"not included"'} + ", slug " + ${includeSlug ? '"included"' : '"not included"'} + ")";
      `;

      const result = await this.run(script);
      return this.respond(result, "Export PDF");
    },

    async exportImages(args) {
      const { folderPath, format = 'PNG', resolution = 300, pageRange = 'all', includeBleed = false } = args;

      const validatedPath = folderPath;
      const fmt = String(format).toUpperCase();
      if (!['PNG', 'JPEG', 'JPG'].includes(fmt)) throw new Error(`Invalid format: ${format} (use PNG or JPEG)`);
      const dpi = this.jsNum(resolution, 'resolution');
      if (dpi < 1 || dpi > 2400) throw new Error(`Invalid resolution: ${resolution} (1-2400 dpi)`);
      const pages = has(args.layout) ? await this.layoutPositions(args.layout, pageRange) : this.parsePageRange(pageRange);

      const script = `
        var doc = __requireDoc();
        var exportFolder = Folder(${this.jsStr(validatedPath)});
        if (!exportFolder.exists && !exportFolder.create()) throw new Error("Cannot create folder: " + exportFolder.fsName);
      
        var isPng = ${fmt === 'PNG' ? 'true' : 'false'};
        var prefs = isPng ? app.pngExportPreferences : app.jpegExportPreferences;
        prefs.exportResolution = ${dpi};
        prefs.useDocumentBleeds = ${includeBleed ? 'true' : 'false'};
        // pageString is ignored (all pages are exported every time) unless the range mode is EXPORT_RANGE
        prefs.exportingSpread = false;
        if (isPng) prefs.pngExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
        else prefs.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE;
        var ext = isPng ? ".png" : ".jpg";
        var base = doc.name.replace(/\\.indd$/i, "");
      
        var wanted = ${pages ? this.jsJson(pages) : 'null'};
        if (wanted === null) {
          wanted = [];
          for (var i = 0; i < doc.pages.length; i++) wanted.push(i + 1);
        }
        var written = [];
        for (var k = 0; k < wanted.length; k++) {
          var n = wanted[k];
          if (n > doc.pages.length) throw new Error("Page " + n + " does not exist (document has " + doc.pages.length + " pages)");
          // "+N" = the Nth page of the document, whatever the page names are (numbering start, sections, repeated names)
          prefs.pageString = "+" + n;
          var out = File(exportFolder.fsName + "/" + base + "_page" + n + ext);
          doc.exportFile(isPng ? ExportFormat.PNG_FORMAT : ExportFormat.JPG, out, false);
          if (!out.exists) throw new Error("Export did not create " + out.fsName);
          written.push(out.fsName);
        }
        "Exported " + written.length + " page(s) as ${fmt === 'PNG' ? 'PNG' : 'JPEG'} at ${dpi} dpi (pages: " + wanted.join(", ") + "):\\n" + written.join("\\n");
      `;

      const result = await this.run(script);
      return this.respond(result, "Export Images");
    },

    async exportEPUB(args) {
      const { filePath, version = 'EPUB3', imageFormat = 'AUTOMATIC' } = args;

      const validatedPath = filePath;
      if (!['EPUB2', 'EPUB3'].includes(version)) throw new Error(`Invalid version: ${version}`);
      if (!['AUTOMATIC', 'PNG', 'JPEG', 'GIF'].includes(imageFormat)) throw new Error(`Invalid imageFormat: ${imageFormat}`);

      const script = `
        var doc = __requireDoc();
        var epubFile = File(${this.jsStr(validatedPath)});
        if (!epubFile.parent.exists) epubFile.parent.create();
        var prefs = doc.epubExportPreferences;
        prefs.version = EpubVersion.${version};
        prefs.imageConversion = ImageConversion.${imageFormat};
        doc.exportFile(ExportFormat.EPUB, epubFile, false);
        if (!epubFile.exists) throw new Error("EPUB export did not create the file");
        "EPUB exported: " + epubFile.fsName + " (" + prefs.version + ", images: ${imageFormat})";
      `;

      const result = await this.run(script);
      return this.respond(result, "Export EPUB");
    },

    async packageDocument(args) {
      const { folderPath, includeLinkedFiles = true, includeFonts = true, createReport = true } = args;

      const validatedPath = folderPath;

      const script = `
        var doc = __requireDoc();
        if (!__hasFile(doc)) throw new Error("Document " + doc.name + " has never been saved. Save it first (save_document with a filePath).");
        var packageFolder = Folder(${this.jsStr(validatedPath)});
        if (!packageFolder.exists && !packageFolder.create()) throw new Error("Cannot create folder: " + packageFolder.fsName);
        // packageForPrint(to, copyingFonts, copyingLinkedGraphics, copyingProfiles, updatingGraphics,
        //                 includingHiddenLayers, ignorePreflightErrors, creatingReport, includeIdml, includePdf,
        //                 versionComments, forceSave)
        doc.packageForPrint(packageFolder, ${includeFonts ? 'true' : 'false'}, ${includeLinkedFiles ? 'true' : 'false'}, true, false, false, true, ${createReport ? 'true' : 'false'}, false, false, "Package created by InDesign MCP Server", false);
        "Document packaged to: " + packageFolder.fsName + " (" + packageFolder.getFiles().length + " items)";
      `;

      const result = await this.run(script);
      return this.respond(result, "Package Document");
    },

    async preflightDocument(args) {
      const { profile, scope = 'document' } = args;

      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          try {
            var preflightProfile;
          
            ${profile ? `
              preflightProfile = app.preflightProfiles.itemByName(${this.jsStr(profile)});
              if (!preflightProfile.isValid) {
                preflightProfile = app.preflightProfiles[0];
              }
            ` : `
              preflightProfile = app.preflightProfiles[0];
            `}
          
            var proc = app.preflightProcesses.add(doc, preflightProfile);
            proc.waitForProcess();
            var summary = String(proc.processResults).replace(/\\s+$/, "");
            proc.remove();
            "Preflight with profile " + preflightProfile.name + ": " + (summary === "None" ? "no issues found" : "issues found:\\n" + summary);
          } catch (e) {
            throw new Error("Error running preflight: " + e.message);
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Preflight Document");
    },
  });

  const handlers = {
    export_pdf: (args) => self.exportPDF(args),
    export_images: (args) => self.exportImages(args),
    export_epub: (args) => self.exportEPUB(args),
    package_document: (args) => self.packageDocument(args),
    preflight_document: (args) => self.preflightDocument(args),
  };

  return { definitions, handlers };
}
