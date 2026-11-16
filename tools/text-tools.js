// Text: frames, content, find/replace, Markdown, typography clean-up, tables.
//
// Moved out of index.js: each tool declares its schema, whether it modifies the document
// (`modifies`) and its handler in this one file. Handlers reach the tool context (run, respond,
// jsStr, jsNum, frameExpr…, lib/tool-context.js) through `this`.

export function createTextTools(ctx) {
  const definitions = [
    {
      name: 'get_selected_objects',
      modifies: false,
      description: 'Get information about currently selected objects in InDesign. ESSENTIAL for working with user-selected text frames.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_text_content',
      modifies: false,
      description: 'Get the text of a text frame (selection, frameId, or frameIndex). Also reports paragraph count and overflow state.',
      inputSchema: {
        type: 'object',
        properties: {
          normalizeSpaces: { type: 'boolean', description: 'Collapse line breaks and repeated spaces', default: true },
          frameId: { type: 'number', description: 'Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex.' },
          frameIndex: { type: 'number', description: 'Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId.' },
          pageIndex: { type: 'number', description: 'Page index (0-based), used with frameIndex', default: 0 },
          maxLength: { type: 'number', description: 'Truncate output to this many characters (0 = no limit)', default: 0 }
        }
      }
    },
    {
      name: 'list_text_frames',
      modifies: false,
      description: 'List the text frames on a page: stable id, index, geometry (mm), overflow state and a text preview. Ordering: index 0 is the frontmost frame (stacking order), NOT creation order - indices shift when frames are added or reordered, so use the id.',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: 'Page index (0-based)', default: 0 }
        }
      }
    },
    {
      name: 'analyze_embedded_objects',
      modifies: false,
      description: 'Analyze embedded objects (MathML formulas, graphics, etc.) in selected text frame or specified frame',
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'Stable object id of the text frame (preferred over frameIndex)' },
          frameIndex: { type: 'number', description: 'Text frame index (optional if frame is selected)' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          maxObjects: { type: 'number', description: 'Maximum number of objects to analyze', default: 5 }
        }
      }
    },
    {
      name: 'insert_markdown_text',
      modifies: true,
      description: 'Insert Markdown into a text frame, mapped to EXISTING styles. Each non-blank line is one paragraph. Supported: "# " to "###### " headers -> paragraph styles "Heading 1".."Heading 6" (aliases tried: "Header N", "HN", "Ueberschrift N"); **bold** -> character style "Bold" (alias "Strong"); *italic* -> "Italic" (alias "Emphasis"); ***both*** -> both styles. Plain paragraphs keep the frame formatting unless bodyStyle is given. Override any style name with styleMap. Fails with a clear error (and changes nothing) if a required style is missing.',
      inputSchema: {
        type: 'object',
        properties: {
          markdownText: { type: 'string', description: 'Markdown text to insert' },
          frameId: { type: 'number', description: 'Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex.' },
          frameIndex: { type: 'number', description: 'Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId.' },
          pageIndex: { type: 'number', description: 'Page index (0-based), used with frameIndex', default: 0 },
          useSelectedFrame: { type: 'boolean', description: 'Use the currently selected text frame', default: false },
          replaceContent: { type: 'boolean', description: 'Replace the whole story (true) or append (false)', default: true },
          bodyStyle: { type: 'string', description: 'Paragraph style for normal paragraphs (optional)' },
          styleMap: {
            type: 'object',
            description: 'Override style names: { h1..h6, body, bold, italic } (paragraph styles for h1-h6/body, character styles for bold/italic)',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['markdownText']
      }
    },
    {
      name: 'fix_typography_in_selection',
      modifies: true,
      description: 'Fix typography in selected text or story. Corrects dates (DD.MM.YYYY with thin spaces), quotes, dashes, and other typographic elements.',
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'Stable object id of the text frame (preferred over frameIndex)' },
          frameIndex: { type: 'number', description: 'Text frame index to fix (use get_selected_objects to work with selection)' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          useSelectedFrame: { type: 'boolean', description: 'Use currently selected text frame', default: false },
          fixDates: { type: 'boolean', description: 'Fix date spacing (DD. MM. YYYY)', default: true },
          fixQuotes: { type: 'boolean', description: 'Fix quotes to typographic quotes', default: true },
          fixDashes: { type: 'boolean', description: 'Fix hyphens to em/en dashes', default: true },
          fixSpaces: { type: 'boolean', description: 'Fix multiple spaces and trailing spaces', default: true }
        }
      }
    },
    {
      name: 'find_typography_issues',
      modifies: false,
      description: 'Analyze text for common typography issues (wrong spaces in dates, straight quotes, double spaces, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'Stable object id of the text frame (preferred over frameIndex)' },
          frameIndex: { type: 'number', description: 'Text frame index to analyze' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          useSelectedFrame: { type: 'boolean', description: 'Analyze currently selected text frame', default: false }
        }
      }
    },
    {
      name: 'clean_imported_text',
      modifies: true,
      description: 'Clean imported text from common typography sins: double paragraph breaks, line breaks instead of paragraphs, trailing spaces, hyphens instead of dashes, manual formatting, bullet lists, hardcoded chapter numbers, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'Stable object id of the text frame (preferred over frameIndex)' },
          frameIndex: { type: 'number', description: 'Text frame index to clean' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          useSelectedFrame: { type: 'boolean', description: 'Clean currently selected text frame', default: false },
          fixParagraphs: { type: 'boolean', description: 'Fix double paragraph breaks and line breaks', default: true },
          fixDashes: { type: 'boolean', description: 'Fix hyphens to proper n-dashes for ranges/thoughts', default: true },
          fixLists: { type: 'boolean', description: 'Remove manual bullet lists and dashes', default: true },
          fixFormatting: { type: 'boolean', description: 'Remove manual bold/italic (prepare for character styles)', default: true },
          fixChapterNumbers: { type: 'boolean', description: 'Remove hardcoded chapter numbers', default: true },
          fixSpaces: { type: 'boolean', description: 'Remove trailing spaces and multiple spaces', default: true }
        }
      }
    },
    {
      name: 'analyze_text_problems',
      modifies: false,
      description: 'Analyze imported text for common problems before cleaning. Shows what issues exist.',
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'Stable object id of the text frame (preferred over frameIndex)' },
          frameIndex: { type: 'number', description: 'Text frame index to analyze' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          useSelectedFrame: { type: 'boolean', description: 'Analyze currently selected text frame', default: false }
        }
      }
    },
    {
      name: 'list_grep_searches',
      modifies: false,
      description: 'List all saved GREP searches in the document (like DATUM search for dates)',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'create_text_frame',
      modifies: true,
      description: 'Create a text frame (mm, origin top-left of the page trim). Only parameters you pass are applied as local formatting; defaults (Helvetica Neue 12 pt, Black, left) are used only when no paragraphStyle is given. Returns the frame id and whether the text overflows. In content, "\\n" makes a paragraph break unless lineBreak is "forced"; "<br>" always makes a forced line break (Shift+Enter).',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Text content. "\\n" = paragraph break (default), "<br>" = forced line break' },
          lineBreak: { type: 'string', enum: ['paragraph', 'forced'], description: 'How "\\n" in content is interpreted', default: 'paragraph' },
          x: { type: 'number', description: 'X position in mm', default: 10 },
          y: { type: 'number', description: 'Y position in mm', default: 10 },
          width: { type: 'number', description: 'Width in mm', default: 100 },
          height: { type: 'number', description: 'Height in mm', default: 50 },
          pageIndex: { type: 'number', description: 'Page index (0-based)', default: 0 },
          fontSize: { type: 'number', description: 'Font size in points (local override)' },
          fontFamily: { type: 'string', description: 'Font family name (local override)' },
          fontStyle: { type: 'string', description: 'Font style (Regular, Bold, Italic, ...) used with fontFamily', default: 'Regular' },
          textColor: { type: 'string', description: 'Swatch name (local override)' },
          alignment: { type: 'string', enum: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'JUSTIFY'], description: 'Paragraph alignment (local override)' },
          paragraphStyle: { type: 'string', description: 'Paragraph style name to apply (error if missing)' },
          characterStyle: { type: 'string', description: 'Character style name to apply to all text' },
        },
        required: ['content'],
      },
    },
    {
      name: 'edit_text_frame',
      modifies: true,
      description: 'Edit a text frame. Setting content replaces the whole story. Returns whether the text overflows. Use frameId (from create_text_frame / list_text_frames) or pageIndex + frameIndex.',
      inputSchema: {
        type: 'object',
        properties: {
          frameId: { type: 'number', description: 'Stable object id of the text frame (returned by create_text_frame / list_text_frames). Preferred over frameIndex.' },
          frameIndex: { type: 'number', description: 'Index in page.textFrames (0 = frontmost). Changes when frames are added or reordered - prefer frameId.' },
          pageIndex: { type: 'number', description: 'Page index (0-based), used with frameIndex', default: 0 },
          content: { type: 'string', description: 'New text (replaces the whole story). "\\n" = paragraph break, "<br>" = forced line break' },
          lineBreak: { type: 'string', enum: ['paragraph', 'forced'], description: 'How "\\n" in content is interpreted', default: 'paragraph' },
          fontSize: { type: 'number', description: 'Font size in points' },
          fontFamily: { type: 'string', description: 'Font family name' },
          fontStyle: { type: 'string', description: 'Font style used with fontFamily', default: 'Regular' },
          textColor: { type: 'string', description: 'Swatch name' },
          alignment: { type: 'string', enum: ['LEFT_ALIGN', 'CENTER_ALIGN', 'RIGHT_ALIGN', 'JUSTIFY'] },
        },
      },
    },
    {
      name: 'find_replace_text',
      modifies: true,
      description: 'Find and replace text. Limit it to where the change belongs: frameId (the story of that frame) or scope story/selection; scope document only for a deliberate global change. Locate first with find_text when unsure. Reports the pages where text was replaced.',
      inputSchema: {
        type: 'object',
        properties: {
          findText: { type: 'string', description: 'Text to find' },
          replaceText: { type: 'string', description: 'Replacement text' },
          caseSensitive: { type: 'boolean', description: 'Case sensitive search', default: false },
          wholeWord: { type: 'boolean', description: 'Whole word only', default: false },
          useGrep: { type: 'boolean', description: 'Use GREP (regular expressions)', default: false },
          scope: { type: 'string', enum: ['document', 'story', 'selection'], default: 'document' },
          frameId: { type: 'number', description: 'Only in the story of this text frame (overrides scope)' },
        },
        required: ['findText', 'replaceText'],
      },
    },
    {
      name: 'create_table',
      modifies: true,
      description: 'Create a table in a new text frame (mm; rows include header and footer rows). Returns the frame id, the rows and the columns.',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X position in mm' },
          y: { type: 'number', description: 'Y position in mm' },
          width: { type: 'number', description: 'Table width in mm' },
          height: { type: 'number', description: 'Table height in mm' },
          rows: { type: 'number', description: 'Number of rows' },
          columns: { type: 'number', description: 'Number of columns' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          headerRows: { type: 'number', description: 'Number of header rows', default: 1 },
          footerRows: { type: 'number', description: 'Number of footer rows', default: 0 },
        },
        required: ['x', 'y', 'width', 'height', 'rows', 'columns'],
      },
    },
    {
      name: 'populate_table',
      modifies: true,
      description: 'Populate table with data',
      inputSchema: {
        type: 'object',
        properties: {
          tableIndex: { type: 'number', description: 'Table index on page' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          data: { type: 'array', description: 'Array of arrays with table data', items: { type: 'array' } },
          includeHeaders: { type: 'boolean', description: 'First row contains headers', default: true },
        },
        required: ['tableIndex', 'data'],
      },
    },
  ];

  const self = Object.assign(Object.create(ctx), {
    async getSelectedObjects() {
      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          var selection = app.selection;
        
          if (selection.length === 0) {
            throw new Error("No objects selected. Please select a text frame or other object first.");
          } else {
            var result = "=== SELECTED OBJECTS ===\\n";
          
            for (var i = 0; i < selection.length; i++) {
              var obj = selection[i];
              result += "Object " + i + ": ";
            
              if (obj.hasOwnProperty('contents')) {
                // Text frame
                result += "Text Frame";
                var content = String(obj.contents).substring(0, 50);
                if (String(obj.contents).length > 50) content += "...";
                result += " - Content: " + content;
              
                // Find frame index on current page
                var currentPage = app.activeWindow.activePage;
                for (var j = 0; j < currentPage.textFrames.length; j++) {
                  if (currentPage.textFrames[j] === obj) {
                    result += " (Frame Index: " + j + ")";
                    break;
                  }
                }
              } else if (obj.hasOwnProperty('geometricBounds')) {
                result += "Shape/Image";
              } else {
                result += "Unknown object type";
              }
              result += "\\n";
            }
          
            result;
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Get Selected Objects");
    },

    async getTextContent(args) {
      const { normalizeSpaces = true, maxLength = 0 } = args;
      const wantsFrame = args.frameId !== undefined || args.frameIndex !== undefined;
      const limit = this.jsNum(maxLength, 'maxLength');

      const script = `
        var doc = __requireDoc();
        var frame = null, textContent = null, source = "";
      
        ${wantsFrame ? `
          frame = ${this.frameExpr(args)};
          textContent = frame.parentStory.contents;
          source = "Text frame id " + frame.id;
        ` : `
          // No frame given: use the selection
          if (app.selection.length > 0) {
            var sel = app.selection[0];
            if (sel.constructor.name === "TextFrame") {
              frame = sel; textContent = sel.parentStory.contents; source = "Selected text frame id " + sel.id;
            } else if (sel.parentTextFrames && sel.parentTextFrames.length > 0) {
              frame = sel.parentTextFrames[0]; textContent = frame.parentStory.contents; source = "Text frame id " + frame.id + " (from selected text)";
            } else {
              throw new Error("Selected object (" + sel.constructor.name + ") has no text. Select a text frame or pass frameId / frameIndex.");
            }
          } else {
            throw new Error("No text frame selected. Select one or pass frameId / frameIndex.");
          }
        `}
      
        var result = "=== TEXT CONTENT ===\\n";
        result += "Source: " + source + "\\n";
        result += "(whole story, including any overflow text)\\n";
        result += "Original length: " + textContent.length + " characters\\n";
        result += "Paragraphs: " + frame.parentStory.paragraphs.length + "\\n";
        result += __overflowNote(frame) + "\\n\\n";
      
        // Forced line breaks (Shift+Enter, character 10) are shown as an arrow in both modes, never as a space
        var processedText = textContent.replace(/\\n/g, "\u21b5");
        ${normalizeSpaces ? `
          processedText = processedText.replace(/\\r+/g, ' ');
          while (processedText.indexOf('  ') !== -1) { processedText = processedText.replace(/  /g, ' '); }
          while (processedText.charAt(0) === ' ') { processedText = processedText.substring(1); }
          while (processedText.charAt(processedText.length - 1) === ' ') { processedText = processedText.substring(0, processedText.length - 1); }
        ` : ''}
        ${limit > 0 ? `
          if (processedText.length > ${limit}) {
            processedText = processedText.substring(0, ${limit}) + "...";
            result += "Text truncated to ${limit} characters\\n\\n";
          }
        ` : ''}
        result += "TEXT:\\n" + processedText;
        result;
      `;

      const result = await this.run(script);
      return this.respond(result, "Get Text Content");
    },

    async listTextFrames(args) {
      const pageIndex = this.jsNum(args.pageIndex === undefined ? 0 : args.pageIndex, 'pageIndex');

      const script = `
        var doc = __requireDoc();
        var page = __page(doc, ${pageIndex});
        var result = "=== TEXT FRAMES ON PAGE " + (${pageIndex} + 1) + " ===\\n";
        result += "(index 0 = frontmost frame; indices change when frames are added or reordered - use id)\\n";
        if (page.textFrames.length === 0) {
          result += "No text frames on this page.";
        } else {
          for (var i = 0; i < page.textFrames.length; i++) {
            var f = page.textFrames[i];
            var b = f.geometricBounds;
            var preview = f.contents.substring(0, 60);
            if (f.contents.length > 60) preview += "...";
            preview = preview.replace(/[\\r\\n\\u2028]/g, "↵").replace(/\\t/g, "→");
            result += "Frame " + i + ": id=" + f.id + " x=" + __r(b[1]) + " y=" + __r(b[0]) + " w=" + __r(b[3] - b[1]) + " h=" + __r(b[2] - b[0]) +
                      " rotation=" + __r(f.rotationAngle) + " " + __overflowNote(f) + " paragraphs=" + f.parentStory.paragraphs.length +
                      (f.contents.length > 0 ? " style=" + JSON_STR(f.paragraphs[0].appliedParagraphStyle.name) + " size=" + __r(f.characters[0].pointSize) + "pt font=" + JSON_STR(f.characters[0].appliedFont.name.replace("\\t", " ")) : "") +
                      " text=" + (preview.length === 0 ? "(empty)" : JSON_STR(preview)) + "\\n";
          }
        }
        result;
      `;

      const result = await this.run(script);
      return this.respond(result, "List Text Frames");
    },

    async analyzeEmbeddedObjects(args) {
      const { frameIndex, pageIndex = 0, maxObjects = 5 } = args;

      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          var frame = null;
        
          // An explicit frame wins; otherwise use the selection
          ${(args.frameId !== undefined || args.frameIndex !== undefined) ? `
            frame = ${this.frameExpr(args)};
          ` : `
            if (app.selection.length > 0 && app.selection[0].constructor.name === "TextFrame") {
              frame = app.selection[0];
            }
          `}
        
          if (!frame) {
            throw new Error("No text frame found. Select a frame or pass frameId / frameIndex.");
          } else {
            var result = "=== EMBEDDED OBJECTS ANALYSIS ===\\n\\n";
          
            // Check if frame contains a table
            var hasTable = false;
            var table = null;
          
            try {
              if (frame.texts && frame.texts.length > 0 && frame.texts[0].tables && frame.texts[0].tables.length > 0) {
                hasTable = true;
                table = frame.texts[0].tables[0];
              }
            } catch (e) {}
          
            if (hasTable) {
              result += "FRAME TYPE: Contains TABLE\\n";
              result += "Table: " + table.rows.length + " rows x " + table.columns.length + " columns\\n\\n";
            
              // Analyze first few cells
              result += "=== FIRST " + Math.min(${maxObjects}, table.cells.length) + " CELLS ===\\n";
              for (var i = 0; i < Math.min(${maxObjects}, table.cells.length); i++) {
                var cell = table.cells[i];
                result += "\\nCell " + i + " (Row " + cell.rowIndex + ", Col " + cell.columnIndex + "):\\n";
                result += "  Content: " + String(cell.contents).substring(0, 100) + "\\n";
              
                // Check for embedded objects in cell
                if (cell.epstexts && cell.epstexts.length > 0) {
                  result += "  EPSTexts: " + cell.epstexts.length + "\\n";
                }
                if (cell.pageItems && cell.pageItems.length > 0) {
                  result += "  Page Items: " + cell.pageItems.length + "\\n";
                
                  // Check first page item
                  var pItem = cell.pageItems[0];
                  result += "  First Item Type: " + pItem.constructor.name + "\\n";
                
                  // If it's a group, check inside
                  if (pItem.constructor.name === "Group" && pItem.allPageItems) {
                    result += "  Group contains: " + pItem.allPageItems.length + " items\\n";
                    if (pItem.allPageItems.length > 0) {
                      result += "  Sub-item type: " + pItem.allPageItems[0].constructor.name + "\\n";
                    }
                  }
                }
              }
            } else {
              result += "FRAME TYPE: Regular text frame\\n\\n";
            }
          
            // Check for different types of embedded content
            result += "EPSTexts (formulas/EPS): " + frame.epstexts.length + "\\n";
            result += "Page Items (anchored): " + frame.pageItems.length + "\\n";
            result += "All Page Items: " + frame.allPageItems.length + "\\n\\n";
          
            // Analyze EPSTexts (MathML formulas are often EPS)
            if (frame.epstexts.length > 0) {
              result += "=== EPS TEXTS (First " + Math.min(${maxObjects}, frame.epstexts.length) + ") ===\\n";
              for (var i = 0; i < Math.min(${maxObjects}, frame.epstexts.length); i++) {
                var eps = frame.epstexts[i];
                result += "\\nObject " + i + ":\\n";
                result += "  Label: " + eps.label + "\\n";
                result += "  ID: " + eps.id + "\\n";
              
                // Try to get fill color
                try {
                  if (eps.fillColor && eps.fillColor.name) {
                    result += "  Fill Color: " + eps.fillColor.name;
                    if (eps.fillColor.space) {
                      result += " (" + eps.fillColor.space + ")";
                    }
                    result += "\\n";
                  }
                } catch (e) {
                  result += "  Fill Color: (cannot access)\\n";
                }
              
                // Try to get bounds
                try {
                  if (eps.geometricBounds) {
                    result += "  Bounds: [" + eps.geometricBounds.join(", ") + "]\\n";
                  }
                } catch (e) {}
              }
            }
          
            // Analyze PageItems
            if (frame.pageItems.length > 0) {
              result += "\\n=== PAGE ITEMS (First " + Math.min(${maxObjects}, frame.pageItems.length) + ") ===\\n";
              for (var i = 0; i < Math.min(${maxObjects}, frame.pageItems.length); i++) {
                var item = frame.pageItems[i];
                result += "\\nItem " + i + ":\\n";
                result += "  Type: " + item.constructor.name + "\\n";
                result += "  Label: " + item.label + "\\n";
              
                // List available properties (only for first item)
                if (i === 0) {
                  result += "  Properties: ";
                  var props = [];
                  for (var prop in item) {
                    try {
                      if (typeof item[prop] !== 'function') {
                        props.push(prop);
                      }
                    } catch (e) {
                      // Skip properties that throw errors
                    }
                  }
                  result += props.slice(0, 30).join(", ") + "\\n";
                }
              
                // Check if it's a group or has sub-items
                try {
                  if (item.allPageItems && item.allPageItems.length > 0) {
                    result += "  Has " + item.allPageItems.length + " sub-items\\n";
                    var firstItem = item.allPageItems[0];
                    result += "  First sub-item type: " + firstItem.constructor.name + "\\n";
                  }
                } catch (e) {}
              
                // Check content type
                try {
                  if (item.contentType) {
                    result += "  Content Type: " + item.contentType + "\\n";
                  }
                } catch (e) {}
              
                // Check if it's a rectangle with graphic
                try {
                  if (item.graphics && item.graphics.length > 0) {
                    result += "  Has Graphics: " + item.graphics.length + "\\n";
                    var graphic = item.graphics[0];
                    result += "  Graphic Type: " + graphic.constructor.name + "\\n";
                  
                    // Try to get the actual file link
                    if (graphic.itemLink && graphic.itemLink.filePath) {
                      result += "  Linked File: " + graphic.itemLink.filePath + "\\n";
                    }
                  }
                } catch (e) {}
              
                // Try alternative access via allGraphics
                try {
                  if (item.allGraphics && item.allGraphics.length > 0) {
                    result += "  AllGraphics: " + item.allGraphics.length + "\\n";
                    var gfx = item.allGraphics[0];
                    result += "  Graphic Type: " + gfx.constructor.name + "\\n";
                  
                    // Try to access EPS/PDF content
                    if (gfx.itemLink) {
                      result += "  Link Name: " + gfx.itemLink.name + "\\n";
                      result += "  Link Status: " + gfx.itemLink.status + "\\n";
                    }
                  
                    // Try to get PDF/EPS data
                    if (gfx.pdfAttributes) {
                      result += "  Has PDF Attributes\\n";
                    }
                    if (gfx.epsText) {
                      result += "  Has EPS Text\\n";
                    }
                  }
                } catch (e) {
                  result += "  AllGraphics Error: " + e.message + "\\n";
                }
              
                // Try to access XML content (MathML)
                try {
                  if (item.associatedXMLElement) {
                    var xmlElem = item.associatedXMLElement;
                    result += "  Has XML Element: YES\\n";
                    result += "  XML Tag: " + xmlElem.markupTag.name + "\\n";
                  
                    // Try to get MathML content
                    if (xmlElem.contents) {
                      var xmlContent = String(xmlElem.contents).substring(0, 500);
                      result += "  XML Content (first 500 chars):\\n    " + xmlContent.replace(/\\n/g, "\\n    ") + "\\n";
                    }
                  }
                } catch (e) {
                  result += "  XML Error: " + e.message + "\\n";
                }
              
                // Check if it contains EPSText
                try {
                  if (item.epstexts && item.epstexts.length > 0) {
                    result += "  Contains EPSTexts: " + item.epstexts.length + "\\n";
                    var eps = item.epstexts[0];
                    result += "  EPS Label: " + eps.label + "\\n";
                  
                    // Try to get EPS content
                    if (eps.epsContent) {
                      var epsContent = String(eps.epsContent).substring(0, 500);
                      result += "  EPS Content (first 500 chars):\\n    " + epsContent.replace(/\\n/g, "\\n    ") + "\\n";
                    }
                  }
                } catch (e) {}
              
                // Try to get fill color
                try {
                  if (item.fillColor && item.fillColor.name) {
                    result += "  Fill Color: " + item.fillColor.name;
                    if (item.fillColor.space) {
                      result += " (" + item.fillColor.space + ")";
                    }
                    result += "\\n";
                  }
                } catch (e) {}
              }
            }
          
            result;
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Analyze Embedded Objects");
    },

    // Markdown -> { text, paras: [{ start, style }], ranges: [{ start, end, kind }] } (offsets in characters)
    parseMarkdown(markdown) {
      const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
      const paras = [];
      const ranges = [];
      let text = '';

      const parseInline = (src) => {
        // Tokenise; unmatched emphasis markers are demoted to literal text.
        const forcedLiteral = new Set();
        for (;;) {
          const tokens = [];
          let buf = '';
          let i = 0;
          const flush = () => { if (buf) { tokens.push({ t: 'text', v: buf }); buf = ''; } };
          while (i < src.length) {
            const ch = src[i];
            if (ch === '\\' && i + 1 < src.length && /[*\\#]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
            let marker = null;
            for (const m of ['***', '**', '*']) { if (src.startsWith(m, i)) { marker = m; break; } }
            if (marker && !forcedLiteral.has(i)) {
              tokens.push({ t: 'text', v: buf }); buf = '';
              tokens[tokens.length - 1].v === '' && tokens.pop();
              tokens.push({ t: 'mark', v: marker, at: i, prev: src[i - 1], next: src[i + marker.length] });
              i += marker.length;
              continue;
            }
            buf += ch; i++;
          }
          flush();

          // Resolve marks
          let bold = false, italic = false, boldAt = -1, italicAt = -1;
          const out = []; // { v, bold, italic }
          for (const tok of tokens) {
            if (tok.t === 'text') { out.push({ v: tok.v, bold, italic }); continue; }
            const canOpen = tok.next !== undefined && !/\s/.test(tok.next);
            const canClose = tok.prev !== undefined && !/\s/.test(tok.prev);
            const wantBold = tok.v === '**' || tok.v === '***';
            const wantItalic = tok.v === '*' || tok.v === '***';
            const closing = (!wantBold || bold) && (!wantItalic || italic) && canClose;
            const opening = (!wantBold || !bold) && (!wantItalic || !italic) && canOpen;
            if (closing) {
              if (wantBold) { bold = false; boldAt = -1; }
              if (wantItalic) { italic = false; italicAt = -1; }
            } else if (opening) {
              if (wantBold) { bold = true; boldAt = tok.at; }
              if (wantItalic) { italic = true; italicAt = tok.at; }
            } else {
              out.push({ v: tok.v, bold, italic }); // literal
            }
          }
          if (bold || italic) {
            // Unclosed emphasis: make its opener literal and parse again
            if (bold && boldAt >= 0) forcedLiteral.add(boldAt);
            if (italic && italicAt >= 0) forcedLiteral.add(italicAt);
            continue;
          }
          return out.filter((r) => r.v !== '');
        }
      };

      for (const line of lines) {
        if (!line.trim()) continue;
        const h = line.match(/^(#{1,6})[ \t]+(.*)$/);
        const level = h ? h[1].length : 0;
        const runs = parseInline(h ? h[2] : line);
        const paraText = runs.map((r) => r.v).join('');
        if (!paraText.trim()) continue;
        if (paras.length > 0) text += '\r';
        const start = text.length;
        paras.push({ start, style: level ? `h${level}` : 'body' });
        let pos = start;
        for (const r of runs) {
          const kind = r.bold && r.italic ? 'boldItalic' : r.bold ? 'bold' : r.italic ? 'italic' : null;
          if (kind && !level) ranges.push({ start: pos, end: pos + r.v.length - 1, kind });
          else if (kind && level) ranges.push({ start: pos, end: pos + r.v.length - 1, kind });
          pos += r.v.length;
        }
        text += paraText;
      }
      return { text, paras, ranges };
    },

    async insertMarkdownText(args) {
      const { markdownText, useSelectedFrame = false, replaceContent = true, bodyStyle, styleMap = {} } = args;
      if (typeof markdownText !== 'string') {
        throw new Error('markdownText is required');
      }

      const parsed = this.parseMarkdown(markdownText);
      if (parsed.paras.length === 0) {
        throw new Error('markdownText contains no text');
      }

      // Style names (paragraph styles for h1-h6/body, character styles for bold/italic/boldItalic)
      const heading = (n) => [`Heading ${n}`, `Header ${n}`, `H${n}`, `Header${n}`, `Überschrift ${n}`, `Ueberschrift ${n}`];
      const candidates = {
        h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4), h5: heading(5), h6: heading(6),
        body: bodyStyle ? [bodyStyle] : [],
        bold: ['Bold', 'Strong', 'Fett'],
        italic: ['Italic', 'Emphasis', 'Kursiv'],
        boldItalic: ['Bold Italic', 'BoldItalic', 'Strong Emphasis', 'Fett Kursiv'],
      };
      for (const [key, name] of Object.entries(styleMap)) {
        if (!(key in candidates)) throw new Error(`Unknown styleMap key: ${key} (use h1-h6, body, bold, italic, boldItalic)`);
        candidates[key] = [String(name)];
      }
      const kinds = { h1: 'p', h2: 'p', h3: 'p', h4: 'p', h5: 'p', h6: 'p', body: 'p', bold: 'c', italic: 'c', boldItalic: 'c' };
      const used = new Set([...parsed.paras.map((p) => p.style), ...parsed.ranges.map((r) => r.kind)]);
      const required = [...used].filter((k) => candidates[k].length > 0).map((k) => ({ key: k, kind: kinds[k], names: candidates[k] }));

      const data = { text: parsed.text, paras: parsed.paras, ranges: parsed.ranges, required };

      const script = `
        var doc = __requireDoc();
        var D = ${this.jsJson(data)};
        var frame;
        ${useSelectedFrame ? `
          if (app.selection.length === 0 || app.selection[0].constructor.name !== "TextFrame") {
            throw new Error("No text frame selected. Select one or pass frameId / frameIndex.");
          }
          frame = app.selection[0];
        ` : `frame = ${this.frameExpr(args)};`}
      
        // 1. Resolve every style first, so a missing style changes nothing
        var resolved = {}, missing = [];
        for (var r = 0; r < D.required.length; r++) {
          var req = D.required[r], hit = null;
          for (var n = 0; n < req.names.length && !hit; n++) {
            var cand = (req.kind === "p" ? doc.paragraphStyles : doc.characterStyles).itemByName(req.names[n]);
            if (cand.isValid) hit = cand;
          }
          if (hit) resolved[req.key] = hit;
          else missing.push((req.kind === "p" ? "paragraph style" : "character style") + " for " + req.key + " (tried: " + req.names.join(", ") + ")");
        }
        if (missing.length > 0) {
          throw new Error("Missing styles - create them first (create_paragraph_style / create_character_style) or map other names with styleMap: " + missing.join("; "));
        }
      
        // 2. Insert the text
        var story = frame.parentStory;
        var offset = 0;
        ${replaceContent ? `
          story.contents = D.text;
        ` : `
          if (story.characters.length > 0) {
            offset = story.characters.length + 1;
            story.insertionPoints[-1].contents = "\\r" + D.text;
          } else {
            story.contents = D.text;
          }
        `}
      
        // 3. Paragraph styles, then character styles
        for (var p = 0; p < D.paras.length; p++) {
          if (resolved[D.paras[p].style]) {
            story.characters[offset + D.paras[p].start].paragraphs[0].appliedParagraphStyle = resolved[D.paras[p].style];
          }
        }
        for (var c = 0; c < D.ranges.length; c++) {
          var rg = D.ranges[c];
          story.characters.itemByRange(offset + rg.start, offset + rg.end).appliedCharacterStyle = resolved[rg.kind];
        }
      
        "Markdown inserted into frame id " + frame.id + ": " + D.paras.length + " paragraphs, " + D.ranges.length + " character runs. " + __overflowNote(frame);
      `;

      const result = await this.run(script);
      return this.respond(result, "Insert Markdown Text");
    },

    async fixTypographyInSelection(args) {
      const { fixDates = true, fixQuotes = true, fixDashes = true, fixSpaces = true } = args;
      const steps = [];
      if (fixDates) steps.push({ find: '(\\d{1,2})\\. (\\d{1,2})\\. (\\d{4})', change: '$1. $2. $3', label: 'Fixed %n date(s) with thin spaces' });
      if (fixQuotes) {
        // Straight or curly double quotes -> German pairs (opening after space/bracket/paragraph start)
        steps.push({ find: '(?<=[\\s(\\[])[“”\\x{0022}]', change: '„', label: 'Set %n opening quote(s)' });
        steps.push({ find: '^[“”\\x{0022}]', change: '„', label: 'Set %n opening quote(s) at paragraph start' });
        steps.push({ find: '(?<=[^\\s(\\[])[”\\x{0022}]', change: '“', label: 'Set %n closing quote(s)' });
      }
      if (fixDashes) {
        steps.push({ find: '--', change: '—', label: 'Fixed %n double hyphen(s) to em dash' });
        steps.push({ find: ' - ', change: ' – ', label: 'Fixed %n spaced hyphen(s) to en dash' });
      }
      if (fixSpaces) {
        steps.push({ find: ' {2,}', change: ' ', label: 'Fixed %n multiple space(s)' });
        steps.push({ find: ' +$', change: '', label: 'Removed %n trailing space(s)' });
      }

      // GREP find/change keeps character and paragraph formatting (rewriting story.contents would not)
      const script = `
        var doc = __requireDoc();
        ${this.textFrameAcquire(args)}
        var story = textFrame.parentStory;
        var changes = 0, n = 0;
        var changeLog = "=== TYPOGRAPHY FIXES ===\\n";
        ${this.grepSteps(steps)}
        if (changes > 0) {
          changeLog += "\\nTotal fixes applied: " + changes;
        } else {
          changeLog += "No typography issues found.";
        }
        changeLog;
      `;

      const result = await this.run(script);
      return this.respond(result, "Fix Typography");
    },

    async findTypographyIssues(args) {
      const { frameIndex, pageIndex = 0, useSelectedFrame = false } = args;

      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          try {
            ${this.textFrameAcquire(args)}
          
            if (textFrame) {
              var content = textFrame.contents;
              var issues = "=== TYPOGRAPHY ANALYSIS ===\\n";
              var problemCount = 0;
            
              // Check for dates with wrong spacing using DATUM search if available
              try {
                var datumQuery = doc.findGrepPreferences.itemByName("DATUM");
                if (datumQuery.isValid) {
                  app.findGrepPreferences = NothingEnum.nothing;
                  app.findGrepPreferences.findWhat = datumQuery.findWhat;
                  var foundDates = textFrame.parentStory.findGrep();
                
                  var wrongSpaceDates = 0;
                  var correctSpaceDates = 0;
                
                  for (var d = 0; d < foundDates.length; d++) {
                    var dateText = foundDates[d].contents;
                    if (dateText.indexOf('\\u2009') === -1 && dateText.match(/\\d{1,2}\\. \\d{1,2}\\. \\d{4}/)) {
                      wrongSpaceDates++;
                    } else if (dateText.indexOf('\\u2009') !== -1) {
                      correctSpaceDates++;
                    }
                  }
                
                  if (wrongSpaceDates > 0) {
                    issues += "❌ " + wrongSpaceDates + " date(s) with normal spaces (found via DATUM search)\\n";
                    problemCount += wrongSpaceDates;
                  }
                  if (correctSpaceDates > 0) {
                    issues += "✅ " + correctSpaceDates + " date(s) with correct thin spaces\\n";
                  }
                
                  app.findGrepPreferences = NothingEnum.nothing;
                } else {
                  throw new Error("DATUM search not found");
                }
              } catch (e) {
                // Fallback to manual pattern check
                var wrongDateSpaces = content.match(/\\d{1,2}\\. \\d{1,2}\\. \\d{4}/g);
                if (wrongDateSpaces) {
                  issues += "❌ " + wrongDateSpaces.length + " date(s) with normal spaces (fallback pattern)\\n";
                  problemCount += wrongDateSpaces.length;
                }
              
                var correctDates = content.match(/\\d{1,2}\\.\\u2009\\d{1,2}\\.\\u2009\\d{4}/g);
                if (correctDates) {
                  issues += "✅ " + correctDates.length + " date(s) with correct thin spaces\\n";
                }
              }
            
              // Check for straight quotes
              var straightQuotes = (content.match(/"/g) || []).length;
              if (straightQuotes > 0) {
                issues += "❌ " + straightQuotes + " straight quote(s) found\\n";
                problemCount += straightQuotes;
              }
            
              // Check for double hyphens
              var doubleHyphens = (content.match(/--/g) || []).length;
              if (doubleHyphens > 0) {
                issues += "❌ " + doubleHyphens + " double hyphen(s) (should be em dash)\\n";
                problemCount += doubleHyphens;
              }
            
              // Check for space-hyphen-space
              var spaceHyphens = (content.match(/ - /g) || []).length;
              if (spaceHyphens > 0) {
                issues += "❌ " + spaceHyphens + " space-hyphen-space (should be en dash)\\n";
                problemCount += spaceHyphens;
              }
            
              // Check for multiple spaces
              var multiSpaces = (content.match(/  +/g) || []).length;
              if (multiSpaces > 0) {
                issues += "❌ " + multiSpaces + " multiple space(s) found\\n";
                problemCount += multiSpaces;
              }
            
              // Check for trailing spaces
              var lines = content.split('\\r');
              var trailingSpaces = 0;
              for (var i = 0; i < lines.length; i++) {
                if (lines[i].match(/ +$/)) {
                  trailingSpaces++;
                }
              }
              if (trailingSpaces > 0) {
                issues += "❌ " + trailingSpaces + " line(s) with trailing spaces\\n";
                problemCount += trailingSpaces;
              }
            
              issues += "\\n=== SUMMARY ===\\n";
              if (problemCount > 0) {
                issues += "Found " + problemCount + " typography issue(s)\\n";
                issues += "Use fix_typography_in_selection() to auto-correct.";
              } else {
                issues += "No typography issues found. Text is clean!";
              }
            
              issues;
            }
          } catch (e) {
            throw new Error("Error analyzing typography: " + e.message);
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Typography Analysis");
    },

    async listGrepSearches() {
      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          try {
            var result = "=== SAVED GREP SEARCHES ===\\n";
          
            if (doc.findGrepPreferences.length === 0) {
              result += "No saved GREP searches found in this document.\\n";
              result += "TIP: Create and save GREP searches in Find/Change dialog.";
            } else {
              for (var i = 0; i < doc.findGrepPreferences.length; i++) {
                var grepSearch = doc.findGrepPreferences[i];
                result += "Search " + (i + 1) + ": " + (grepSearch.name || "Unnamed") + "\\n";
                result += "  Pattern: " + grepSearch.findWhat + "\\n";
                if (grepSearch.changeTo) {
                  result += "  Replace: " + grepSearch.changeTo + "\\n";
                }
                result += "\\n";
              }
            
              // Special note about DATUM search
              try {
                var datumQuery = doc.findGrepPreferences.itemByName("DATUM");
                if (datumQuery.isValid) {
                  result += "✅ DATUM search found - will be used for date typography fixes.";
                } else {
                  result += "❌ DATUM search not found - typography fixes will use fallback patterns.";
                }
              } catch (e) {
                result += "❌ DATUM search not accessible - using fallback patterns.";
              }
            }
          
            result;
          } catch (e) {
            throw new Error("Error listing GREP searches: " + e.message);
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "GREP Searches");
    },

    async cleanImportedText(args) {
      const { fixParagraphs = true, fixDashes = true, fixLists = true, fixFormatting = true, fixChapterNumbers = true, fixSpaces = true } = args;
      const steps = [];
      if (fixSpaces) {
        steps.push({ find: ' +$', change: '', label: 'Removed %n trailing space(s)' });
        steps.push({ find: ' {2,}', change: ' ', label: 'Fixed %n multiple space(s)' });
      }
      if (fixParagraphs) {
        steps.push({ find: '\\r{2,}', change: '\\r', label: 'Fixed %n double paragraph break(s)' });
        steps.push({ find: '\\n', change: '\\r', label: 'Converted %n line break(s) to paragraphs' });
      }
      if (fixDashes) {
        steps.push({ find: '(\\d+)-(\\d+)', change: '$1–$2', label: 'Fixed %n number range(s) to n-dash' });
        steps.push({ find: ' - ', change: ' – ', label: 'Fixed %n thought dash(es) to n-dash' });
      }
      if (fixLists) {
        steps.push({ find: '^[•·-][ \\t]+', change: '', label: 'Removed %n manual bullet(s)/dash(es)' });
        steps.push({ find: '^\\t[•·-][ \\t]+', change: '', label: 'Removed %n tabbed bullet(s)' });
      }
      if (fixChapterNumbers) {
        steps.push({ find: '(?i)^(Kapitel|Chapter|Teil|Part)[ \\t]+\\d+[.:]*[ \\t]*', change: '', label: 'Removed %n hardcoded chapter number(s)' });
        // Roman numerals only with a dot/colon and a following space, so words like "Ich" or "Vier" stay intact
        steps.push({ find: '^[IVXLC]+[.:][ \\t]+', change: '', label: 'Removed %n roman numeral(s)' });
      }

      const script = `
        var doc = __requireDoc();
        ${this.textFrameAcquire(args)}
        var story = textFrame.parentStory;
        var changes = 0, n = 0;
        var changeLog = "=== TEXT CLEANING REPORT ===\\n";
        ${this.grepSteps(steps)}
        ${fixFormatting ? `
          // Remove local character overrides (manual bold/italic/size); applied styles stay in place
          story.texts[0].clearOverrides(OverrideType.CHARACTER_ONLY);
          changeLog += "✓ Cleared local character formatting overrides\\n";
          changes += 1;
        ` : ''}
        if (changes > 0) {
          changeLog += "\\n=== SUMMARY ===\\n";
          changeLog += "Total changes applied: " + changes + "\\n";
          changeLog += "Next steps: apply paragraph styles and character styles.";
        } else {
          changeLog += "No issues found - text is already clean!";
        }
        changeLog;
      `;

      const result = await this.run(script);
      return this.respond(result, "Text Cleaning");
    },

    async analyzeTextProblems(args) {
      const { frameIndex, pageIndex = 0, useSelectedFrame = false } = args;

      const script = `
        if (app.documents.length === 0) {
          throw new Error("No document open");
        } else {
          var doc = app.activeDocument;
          try {
            ${this.textFrameAcquire(args)}
          
            if (textFrame) {
              var content = textFrame.contents;
              var issues = "=== TEXT PROBLEM ANALYSIS ===\\n";
              var problemCount = 0;
            
              // Check trailing spaces
              var trailingSpaces = (content.match(/ +\\r/g) || []).length;
              if (trailingSpaces > 0) {
                issues += "❌ " + trailingSpaces + " line(s) with trailing spaces\\n";
                problemCount += trailingSpaces;
              }
            
              // Check double paragraph breaks
              var doublePars = (content.match(/\\r\\r+/g) || []).length;
              if (doublePars > 0) {
                issues += "❌ " + doublePars + " double paragraph break(s) (fake spacing)\\n";
                problemCount += doublePars;
              }
            
              // Check line breaks instead of paragraphs
              var lineBreaks = (content.match(/\\n/g) || []).length;
              if (lineBreaks > 0) {
                issues += "❌ " + lineBreaks + " line break(s) should be paragraphs\\n";
                problemCount += lineBreaks;
              }
            
              // Check hyphen ranges
              var hyphenRanges = (content.match(/\\d+-\\d+/g) || []).length;
              if (hyphenRanges > 0) {
                issues += "❌ " + hyphenRanges + " number range(s) with hyphen (should be n-dash)\\n";
                problemCount += hyphenRanges;
              }
            
              // Check thought dashes
              var thoughtDashes = (content.match(/ - /g) || []).length;
              if (thoughtDashes > 0) {
                issues += "❌ " + thoughtDashes + " thought dash(es) with hyphen (should be n-dash)\\n";
                problemCount += thoughtDashes;
              }
            
              // Check manual bullets
              var bulletLists = (content.match(/^[•·-]\\s/gm) || []).length;
              var tabBullets = (content.match(/^\\t[•·-]\\s/gm) || []).length;
              if (bulletLists > 0 || tabBullets > 0) {
                issues += "❌ " + (bulletLists + tabBullets) + " manual bullet(s)/dash(es) found\\n";
                problemCount += (bulletLists + tabBullets);
              }
            
              // Check hardcoded chapter numbers
              var chapterNumbers = (content.match(/^(Kapitel|Chapter|Teil|Part)\\s+\\d+/gmi) || []).length;
              var romanNumbers = (content.match(/^[IVX]+[.:]/gm) || []).length;
              if (chapterNumbers > 0 || romanNumbers > 0) {
                issues += "❌ " + (chapterNumbers + romanNumbers) + " hardcoded chapter number(s)\\n";
                problemCount += (chapterNumbers + romanNumbers);
              }
            
              // Check multiple spaces
              var multipleSpaces = (content.match(/  +/g) || []).length;
              if (multipleSpaces > 0) {
                issues += "❌ " + multipleSpaces + " multiple space(s) found\\n";
                problemCount += multipleSpaces;
              }
            
              // Check for manual formatting (rough estimate)
              var story = textFrame.parentStory;
              var hasManualFormatting = false;
              try {
                for (var i = 0; i < Math.min(story.characters.length, 100); i++) {
                  var ch = story.characters[i];
                  if (ch.fontStyle !== "Regular" && ch.appliedCharacterStyle.name === "[None]") {
                    hasManualFormatting = true;
                    break;
                  }
                }
                if (hasManualFormatting) {
                  issues += "❌ Manual bold/italic formatting detected (should use character styles)\\n";
                  problemCount += 1;
                }
              } catch (e) {}
            
              issues += "\\n=== SUMMARY ===\\n";
              if (problemCount > 0) {
                issues += "Found " + problemCount + " problem(s) in imported text\\n";
                issues += "⚡ Use clean_imported_text() to auto-fix these issues\\n";
                issues += "\\nThis looks like imported Word/text file content that needs cleaning.";
              } else {
                issues += "✅ No major problems found - text looks clean!\\n";
                issues += "Text appears to be properly formatted for InDesign.";
              }
            
              issues;
            }
          } catch (e) {
            throw new Error("Error analyzing text: " + e.message);
          }
        }
      `;

      const result = await this.run(script);
      return this.respond(result, "Text Analysis");
    },

    async createTextFrame(args) {
      const {
        content,
        x = 10,
        y = 10,
        width = 100,
        height = 50,
        pageIndex = 0,
        fontSize,
        fontFamily,
        fontStyle = 'Regular',
        textColor,
        alignment,
        paragraphStyle,
        characterStyle,
        lineBreak = 'paragraph'
      } = args;

      if (content === undefined || content === null) {
        throw new Error('content is required');
      }
      const nx = this.jsNum(x, 'x');
      const ny = this.jsNum(y, 'y');
      const nw = this.jsNum(width, 'width');
      const nh = this.jsNum(height, 'height');
      const pageIdx = this.jsNum(pageIndex, 'pageIndex');
      const text = this.toInDesignText(content, lineBreak);

      // Direct formatting would override a paragraph style, so the old defaults are only
      // used when no style is requested. Values the caller passed always apply (and must be valid).
      const explicitFont = !!fontFamily;
      const font = fontFamily || (!paragraphStyle ? 'Helvetica Neue' : undefined);
      const explicitColor = !!textColor;
      const color = textColor || (!paragraphStyle ? 'Black' : undefined);
      const size = fontSize !== undefined ? this.jsNum(fontSize, 'fontSize') : (!paragraphStyle ? 12 : undefined);
      const align = alignment || (!paragraphStyle ? 'LEFT_ALIGN' : undefined);

      const script = `
        var doc = __requireDoc();
        var page = __page(doc, ${pageIdx});
        var pStyle = ${paragraphStyle ? `__pstyle(doc, ${this.jsStr(paragraphStyle)})` : 'null'};
        var cStyle = ${characterStyle ? `__cstyle(doc, ${this.jsStr(characterStyle)})` : 'null'};
        var notes = [];
      
        var frame = page.textFrames.add();
        try {
          frame.geometricBounds = [${ny}, ${nx}, ${ny + nh}, ${nx + nw}];
          // Style the empty frame before inserting the text: InDesign converts straight quotes for the
          // language at the insertion point, which must be the style's language, not the UI default
          if (pStyle) { try { frame.insertionPoints[0].appliedParagraphStyle = pStyle; } catch (e) {} }
          frame.contents = ${this.jsStr(text)};
          var story = frame.parentStory;
          var range = story.texts[0];
        
          // Style first, so explicit formatting can override it
          if (pStyle) range.appliedParagraphStyle = pStyle;
          if (cStyle) range.appliedCharacterStyle = cStyle;
        
          ${font ? `
            try {
              __applyFont(range, ${this.jsStr(font)}, ${this.jsStr(fontStyle)});
            } catch (fe) {
              ${explicitFont ? 'throw fe;' : 'notes.push("default font not available, kept the current font");'}
            }
          ` : ''}
          ${size !== undefined ? `range.pointSize = ${size};` : ''}
          ${color ? `
            try {
              range.fillColor = __swatch(doc, ${this.jsStr(color)});
            } catch (ce) {
              ${explicitColor ? 'throw ce;' : 'notes.push("default colour not available, kept the current colour");'}
            }
          ` : ''}
          ${align ? `range.justification = Justification.${this.jsEnum(align, 'alignment')};` : ''}
        } catch (e) {
          frame.remove();
          throw e;
        }
      
        var b = frame.geometricBounds;
        "Text frame created: id=" + frame.id + " page=" + (${pageIdx} + 1) + " x=" + __r(b[1]) + " y=" + __r(b[0]) + " w=" + __r(b[3] - b[1]) + " h=" + __r(b[2] - b[0]) +
          " paragraphs=" + story.paragraphs.length + " " + __overflowNote(frame) + (notes.length ? " (" + notes.join("; ") + ")" : "");
      `;

      const result = await this.run(script);
      return this.respond(result, "Create Text Frame");
    },

    async editTextFrame(args) {
      const { content, fontSize, fontFamily, fontStyle = 'Regular', textColor, alignment, lineBreak = 'paragraph' } = args;
      const text = content !== undefined ? this.toInDesignText(content, lineBreak) : undefined;

      const script = `
        var doc = __requireDoc();
        var frame = ${this.frameExpr(args)};
        var story = frame.parentStory;
      
        ${text !== undefined ? `
          // Replace the whole story, not just the first paragraph
          var newText = ${this.jsStr(text)};
          story.contents = newText;
          if (story.characters.length > newText.length) {
            story.characters.itemByRange(newText.length, story.characters.length - 1).remove();
          }
        ` : ''}
        var range = story.texts[0];
        ${fontFamily !== undefined ? `__applyFont(range, ${this.jsStr(fontFamily)}, ${this.jsStr(fontStyle)});` : ''}
        ${fontSize !== undefined ? `range.pointSize = ${this.jsNum(fontSize, 'fontSize')};` : ''}
        ${textColor !== undefined ? `range.fillColor = __swatch(doc, ${this.jsStr(textColor)});` : ''}
        ${alignment !== undefined ? `range.justification = Justification.${this.jsEnum(alignment, 'alignment')};` : ''}
      
        "Text frame id=" + frame.id + " updated: paragraphs=" + story.paragraphs.length + " " + __overflowNote(frame);
      `;

      const result = await this.run(script);
      return this.respond(result, "Edit Text Frame");
    },

    async findReplaceText(args) {
      const { findText, replaceText, caseSensitive = false, wholeWord = false, useGrep = false } = args;
      const scope = args.frameId !== undefined && args.frameId !== null ? 'frame' : (args.scope || 'document');
      if (!['document', 'story', 'selection', 'frame'].includes(scope)) throw new Error(`Invalid scope: ${scope}`);

      const script = `
        var doc = __requireDoc();
        var target = doc;
        ${scope === 'frame' ? `
          target = __textFrame(doc, ${this.jsNum(args.frameId, 'frameId')}, null, null).parentStory;
        ` : scope === 'story' ? `
          if (app.selection.length === 0 || !app.selection[0].parentStory) throw new Error("scope 'story' needs a selection inside a text story");
          target = app.selection[0].parentStory;
        ` : scope === 'selection' ? `
          if (app.selection.length === 0) throw new Error("scope 'selection' needs something selected");
          target = app.selection[0];
        ` : ''}
      
        app.findTextPreferences = NothingEnum.nothing;
        app.changeTextPreferences = NothingEnum.nothing;
        app.findGrepPreferences = NothingEnum.nothing;
        app.changeGrepPreferences = NothingEnum.nothing;
        var found = [];
        try {
          ${useGrep ? `
            app.findGrepPreferences.findWhat = ${this.jsStr(findText)};
            app.changeGrepPreferences.changeTo = ${this.jsStr(replaceText)};
            found = target.changeGrep();
          ` : `
            app.findTextPreferences.findWhat = ${this.jsStr(findText)};
            app.changeTextPreferences.changeTo = ${this.jsStr(replaceText)};
            app.findChangeTextOptions.caseSensitive = ${caseSensitive ? 'true' : 'false'};
            app.findChangeTextOptions.wholeWord = ${wholeWord ? 'true' : 'false'};
            found = target.changeText();
          `}
        } finally {
          app.findTextPreferences = NothingEnum.nothing;
          app.changeTextPreferences = NothingEnum.nothing;
          app.findGrepPreferences = NothingEnum.nothing;
          app.changeGrepPreferences = NothingEnum.nothing;
        }
        // Where the replacements landed: page names and frame ids (pasteboard / overset noted)
        var where = {}, order = [];
        for (var i = 0; i < found.length; i++) {
          var key = "overset text";
          try {
            var tf = found[i].parentTextFrames;
            if (tf.length) key = "p." + (tf[0].parentPage ? tf[0].parentPage.name : "pasteboard") + " frame " + tf[0].id;
          } catch (e) {}
          if (!where[key]) { where[key] = 0; order.push(key); }
          where[key]++;
        }
        var loc = [];
        for (var j = 0; j < order.length && j < 30; j++) loc.push(order[j] + (where[order[j]] > 1 ? " (x" + where[order[j]] + ")" : ""));
        "Replaced " + found.length + " instance(s) of " + ${this.jsStr(findText)} + " with " + ${this.jsStr(replaceText)} + " (scope: ${scope})" +
          (loc.length ? "\\nWhere: " + loc.join("; ") + (order.length > 30 ? "; ..." : "") : "");
      `;

      const result = await this.run(script);
      return this.respond(result, "Find/Replace Text");
    },

    async createTable(args) {
      const { pageIndex = 0, headerRows = 1, footerRows = 0 } = args;
      const nx = this.jsNum(args.x, 'x'), ny = this.jsNum(args.y, 'y');
      const nw = this.jsNum(args.width, 'width'), nh = this.jsNum(args.height, 'height');
      const rows = Math.floor(this.jsNum(args.rows, 'rows')), columns = Math.floor(this.jsNum(args.columns, 'columns'));
      const head = Math.floor(this.jsNum(headerRows, 'headerRows')), foot = Math.floor(this.jsNum(footerRows, 'footerRows'));
      const pageIdx = this.jsNum(pageIndex, 'pageIndex');
      if (columns < 1 || rows < head + foot + 1) {
        throw new Error(`rows (${rows}) must be at least headerRows + footerRows + 1 (${head + foot + 1}); columns must be >= 1`);
      }

      const script = `
        var doc = __requireDoc();
        var page = __page(doc, ${pageIdx});
        var frame = page.textFrames.add();
        var table;
        try {
          frame.geometricBounds = [${ny}, ${nx}, ${ny + nh}, ${nx + nw}];
          table = frame.tables.add();
          table.columnCount = ${columns};
          table.bodyRowCount = ${rows - head - foot};
          ${head > 0 ? `table.headerRowCount = ${head};` : ''}
          ${foot > 0 ? `table.footerRowCount = ${foot};` : ''}
        } catch (e) {
          frame.remove();
          throw e;
        }
        "Table created: frame id=" + frame.id + " page=" + (${pageIdx} + 1) + " rows=" + table.rows.length + " columns=" + table.columns.length +
          " (header " + table.headerRowCount + ", footer " + table.footerRowCount + "). " + __overflowNote(frame);
      `;

      const result = await this.run(script);
      return this.respond(result, "Create Table");
    },

    async populateTable(args) {
      const { tableIndex, pageIndex = 0, data, includeHeaders = true } = args;
      if (!Array.isArray(data) || data.some((r) => !Array.isArray(r))) throw new Error('data must be an array of arrays');
      const cells = data.map((row) => row.map((v) => (v === null || v === undefined ? '' : String(v))));

      const script = `
        var doc = __requireDoc();
        var page = __page(doc, ${this.jsNum(pageIndex, 'pageIndex')});
        var tables = [];
        for (var i = 0; i < page.textFrames.length; i++) {
          for (var j = 0; j < page.textFrames[i].tables.length; j++) tables.push(page.textFrames[i].tables[j]);
        }
        var wanted = ${this.jsNum(tableIndex, 'tableIndex')};
        if (wanted < 0 || wanted >= tables.length) {
          throw new Error("Table index " + wanted + " not found. The page has " + tables.length + " table(s).");
        }
        var table = tables[wanted];
        var tableData = ${this.jsJson(cells)};
        // includeHeaders=false: leave the header rows alone and start in the first body row
        var offset = ${includeHeaders ? '0' : 'table.headerRowCount'};
        var written = 0;
        for (var r = 0; r < tableData.length && r + offset < table.rows.length; r++) {
          var rowCells = table.rows[r + offset].cells;
          for (var c = 0; c < tableData[r].length && c < rowCells.length; c++) {
            rowCells[c].contents = tableData[r][c];
            written++;
          }
        }
        "Table populated: " + written + " cell(s) written (table has " + table.rows.length + " rows x " + table.columns.length + " columns)";
      `;

      const result = await this.run(script);
      return this.respond(result, "Populate Table");
    },
  });

  const handlers = {
    get_selected_objects: () => self.getSelectedObjects(),
    get_text_content: (args) => self.getTextContent(args),
    list_text_frames: (args) => self.listTextFrames(args),
    analyze_embedded_objects: (args) => self.analyzeEmbeddedObjects(args),
    insert_markdown_text: (args) => self.insertMarkdownText(args),
    fix_typography_in_selection: (args) => self.fixTypographyInSelection(args),
    find_typography_issues: (args) => self.findTypographyIssues(args),
    clean_imported_text: (args) => self.cleanImportedText(args),
    analyze_text_problems: (args) => self.analyzeTextProblems(args),
    list_grep_searches: () => self.listGrepSearches(),
    create_text_frame: (args) => self.createTextFrame(args),
    edit_text_frame: (args) => self.editTextFrame(args),
    find_replace_text: (args) => self.findReplaceText(args),
    create_table: (args) => self.createTable(args),
    populate_table: (args) => self.populateTable(args),
  };

  return { definitions, handlers };
}
