// Object, layout, text-range and document tools.
//
// Coordinates: millimetres, origin at the top-left corner of the page's TRIM area
// (each page of a spread has its own origin); negative values reach into the bleed.
// Objects are addressed by their stable `id` (returned by every create_* / place_image
// call and by list_page_items). `pageIndex` + `index` (position in list_page_items) is
// accepted as a fallback, but indices shift when objects are added or reordered.

import { jsStr, jsJson, jsNum, jsEnum } from '../lib/script-runtime.js';
import { deltaE, toHex } from '../lib/color.js';
import { has } from '../lib/tool-context.js';

// autosizeReference -> AutoSizingReferenceEnum
const AUTOSIZE_REFERENCES = {
  'top-left': 'TOP_LEFT_POINT', top: 'TOP_CENTER_POINT', 'top-right': 'TOP_RIGHT_POINT',
  left: 'LEFT_CENTER_POINT', center: 'CENTER_POINT', right: 'RIGHT_CENTER_POINT',
  'bottom-left': 'BOTTOM_LEFT_POINT', bottom: 'BOTTOM_CENTER_POINT', 'bottom-right': 'BOTTOM_RIGHT_POINT',
};

const OBJECT_PROPS = {
  id: { type: 'number', description: 'Stable object id (from create_* tools, place_image or list_page_items). Preferred.' },
  pageIndex: { type: 'number', description: 'Page index (0-based); used with index', default: 0 },
  index: { type: 'number', description: 'Position in list_page_items for that page (changes when objects are added/reordered)' },
};

const FRAME_PROPS = {
  frameId: { type: 'number', description: 'Stable id of the text frame. Preferred over frameIndex.' },
  frameIndex: { type: 'number', description: 'Index in page.textFrames (0 = frontmost)' },
  pageIndex: { type: 'number', description: 'Page index (0-based), used with frameIndex', default: 0 },
};

const ANCHORS = {
  center: 'CENTER_ANCHOR',
  'top-left': 'TOP_LEFT_ANCHOR',
  top: 'TOP_CENTER_ANCHOR',
  'top-right': 'TOP_RIGHT_ANCHOR',
  left: 'LEFT_CENTER_ANCHOR',
  right: 'RIGHT_CENTER_ANCHOR',
  'bottom-left': 'BOTTOM_LEFT_ANCHOR',
  bottom: 'BOTTOM_CENTER_ANCHOR',
  'bottom-right': 'BOTTOM_RIGHT_ANCHOR',
};


export function createExtraTools(ctx) {
  const { run, respond } = ctx;
  const num = (v, label) => (has(v) ? jsNum(v, label) : 'null');

  // JS expression resolving any page item
  const objExpr = (args) => `__resolve(doc, ${num(args.id, 'id')}, ${num(args.pageIndex, 'pageIndex')}, ${num(args.index, 'index')})`;
  const frameExpr = (args) => ctx.frameExpr(args);

  const definitions = [
    // ---------------- objects & layout ----------------
    {
      name: 'list_page_items',
      modifies: false,
      description: 'List all objects on a page (text frames, rectangles, ovals, polygons, lines, groups, image frames) with id, type, geometry in mm, rotation, fill and overflow state. Objects inside groups are listed with their group id.',
      inputSchema: {
        type: 'object',
        properties: {
          pageIndex: { type: 'number', description: 'Page index (0-based)', default: 0 },
          type: { type: 'string', description: 'Only this type: TextFrame, Rectangle, Oval, Polygon, GraphicLine, Group', },
        },
      },
    },
    {
      name: 'delete_object',
      modifies: true,
      destructive: 'deletes an object from the document',
      description: 'Delete a text frame, rectangle, ellipse, image frame or group',
      inputSchema: { type: 'object', properties: { ...OBJECT_PROPS } },
    },
    {
      name: 'rotate_object',
      modifies: true,
      description: 'Rotate an object. Positive angles turn counter-clockwise (as in the InDesign UI). By default the angle is added to the current rotation; with absolute=true it sets the rotation. reference chooses the pivot point.',
      inputSchema: {
        type: 'object',
        properties: {
          ...OBJECT_PROPS,
          angle: { type: 'number', description: 'Degrees, counter-clockwise positive' },
          absolute: { type: 'boolean', description: 'Set the rotation instead of adding to it', default: false },
          reference: { type: 'string', enum: Object.keys(ANCHORS), description: 'Pivot point', default: 'center' },
        },
        required: ['angle'],
      },
    },
    {
      name: 'set_object_geometry',
      modifies: true,
      description: 'Move and/or resize an object (x, y, width, height in mm, top-left of the unrotated frame); optionally set absolute rotation and shear (degrees). Omitted values are kept. Rotation is applied about the object centre.',
      inputSchema: {
        type: 'object',
        properties: {
          ...OBJECT_PROPS,
          x: { type: 'number', description: 'Left edge in mm' },
          y: { type: 'number', description: 'Top edge in mm' },
          width: { type: 'number', description: 'Width in mm' },
          height: { type: 'number', description: 'Height in mm' },
          rotation: { type: 'number', description: 'Absolute rotation in degrees (counter-clockwise positive)' },
          shear: { type: 'number', description: 'Absolute shear angle in degrees' },
        },
      },
    },
    ...[
      ['send_to_back', 'Send an object to the back of the stacking order'],
      ['bring_to_front', 'Bring an object to the front of the stacking order'],
      ['send_backward', 'Move an object one step back in the stacking order'],
      ['bring_forward', 'Move an object one step forward in the stacking order'],
    ].map(([name, description]) => ({
      name,
      modifies: true,
      description,
      inputSchema: { type: 'object', properties: { ...OBJECT_PROPS } },
    })),
    {
      name: 'set_object_opacity',
      modifies: true,
      description: 'Set opacity (0-100) and/or blend mode of an object, its fill or its stroke (e.g. semi-transparent colour bands).',
      inputSchema: {
        type: 'object',
        properties: {
          ...OBJECT_PROPS,
          opacity: { type: 'number', description: 'Opacity in percent (0-100)' },
          blendMode: { type: 'string', description: 'BlendMode name: NORMAL, MULTIPLY, SCREEN, OVERLAY, SOFT_LIGHT, HARD_LIGHT, COLOR_DODGE, COLOR_BURN, DARKEN, LIGHTEN, DIFFERENCE, EXCLUSION, HUE, SATURATION, COLOR, LUMINOSITY' },
          target: { type: 'string', enum: ['object', 'fill', 'stroke'], description: 'What the setting applies to', default: 'object' },
        },
      },
    },
    {
      name: 'set_object_overprint',
      modifies: true,
      description: 'Set overprint for the fill and/or stroke of an object (print production)',
      inputSchema: {
        type: 'object',
        properties: {
          ...OBJECT_PROPS,
          fill: { type: 'boolean', description: 'Overprint fill' },
          stroke: { type: 'boolean', description: 'Overprint stroke' },
        },
      },
    },
    {
      name: 'set_text_frame_options',
      modifies: true,
      description: 'Set text frame options: insets (mm), vertical alignment, columns, auto-size and text wrap (wrap also works on other objects so text flows around them).',
      inputSchema: {
        type: 'object',
        properties: {
          ...OBJECT_PROPS,
          inset: { type: 'number', description: 'Inset on all sides in mm' },
          insetTop: { type: 'number', description: 'Top inset in mm' },
          insetLeft: { type: 'number', description: 'Left inset in mm' },
          insetBottom: { type: 'number', description: 'Bottom inset in mm' },
          insetRight: { type: 'number', description: 'Right inset in mm' },
          verticalAlignment: { type: 'string', enum: ['TOP', 'CENTER', 'BOTTOM', 'JUSTIFY'] },
          columns: { type: 'number', description: 'Number of columns' },
          columnGutter: { type: 'number', description: 'Column gutter in mm' },
          autosize: { type: 'string', enum: ['OFF', 'HEIGHT_ONLY', 'WIDTH_ONLY', 'HEIGHT_AND_WIDTH', 'HEIGHT_AND_WIDTH_PROPORTIONALLY'], description: 'Auto-sizing type' },
          autosizeReference: { type: 'string', enum: Object.keys(AUTOSIZE_REFERENCES), description: 'Point of the frame that stays in place when auto-size resizes it (default with autosize: top-left, so the frame keeps its x / y)' },
          textWrap: { type: 'string', enum: ['NONE', 'BOUNDING_BOX', 'CONTOUR', 'JUMP_OBJECT', 'NEXT_COLUMN'], description: 'How text wraps around this object' },
          textWrapOffset: { type: 'number', description: 'Text wrap offset on all sides in mm' },
        },
      },
    },
    {
      name: 'group_objects',
      modifies: true,
      description: 'Group objects (by id) and return the group id. name: what the group is ("Pattern strip", "Info box"), shown in the Layers panel and by list_page_items. The objects must be on the same spread.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'number' }, description: 'Ids of the objects to group (at least 2)' },
          name: { type: 'string', description: 'Name of the group: what it is on the page' },
        },
        required: ['ids'],
      },
    },
    {
      name: 'name_object',
      modifies: true,
      description: 'Name an object (any page item, group included) by what it is on the page ("Background", "Headline"): the name shows in the Layers panel, list_page_items and review tables.',
      inputSchema: {
        type: 'object',
        properties: {
          ...OBJECT_PROPS,
          name: { type: 'string', description: 'New name ("" removes it)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'ungroup',
      modifies: true,
      description: 'Ungroup a group; returns the ids of the released objects',
      inputSchema: { type: 'object', properties: { ...OBJECT_PROPS } },
    },

    // ---------------- text ----------------
    {
      name: 'apply_character_style_to_range',
      modifies: true,
      description: 'Apply a character style to a character range of a text frame (e.g. bold words inside a paragraph). Give startIndex/endIndex (inclusive, characters within the story) or matchText to style every occurrence of a text.',
      inputSchema: {
        type: 'object',
        properties: {
          ...FRAME_PROPS,
          styleName: { type: 'string', description: 'Character style name' },
          startIndex: { type: 'number', description: 'First character (0-based)' },
          endIndex: { type: 'number', description: 'Last character (inclusive)' },
          matchText: { type: 'string', description: 'Style every occurrence of this text instead of a range' },
        },
        required: ['styleName'],
      },
    },
    {
      name: 'clear_overrides',
      modifies: true,
      description: 'Remove local formatting overrides from a whole text frame or a character range so the paragraph/character styles show through',
      inputSchema: {
        type: 'object',
        properties: {
          ...FRAME_PROPS,
          startIndex: { type: 'number', description: 'First character (0-based); omit for the whole frame' },
          endIndex: { type: 'number', description: 'Last character (inclusive)' },
        },
      },
    },

    // ---------------- documents ----------------
    {
      name: 'list_open_documents',
      modifies: false,
      description: 'List all open documents with name, page count, saved/modified state and which one is active',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'activate_document',
      modifies: false,
      description: 'Make an open document the active one (by name as shown by list_open_documents)',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Document name' } },
        required: ['name'],
      },
    },

    // ---------------- colour ----------------
    {
      name: 'convert_rgb_to_cmyk',
      modifies: false,
      description: 'Convert an RGB colour (0-255 values or hex) to CMYK percentages. conversion "profile" (default) uses the colour management of InDesign with the CMYK profile of the active document (accurate: hues stay put, and it tells you when the colour is outside the print gamut and how it will really look). "simple" is a plain formula without a profile, needs no document, and shifts hues (greens toward blue).',
      inputSchema: {
        type: 'object',
        properties: {
          rgb: { type: 'array', items: { type: 'number' }, description: '[R,G,B] 0-255 (sRGB)' },
          hex: { type: 'string', description: 'Hex colour such as #FF6600' },
          conversion: { type: 'string', enum: ['profile', 'simple'], description: 'profile = InDesign colour management (needs an open document); simple = formula', default: 'profile' },
        },
      },
    },
  ];

  const handlers = {
    async list_page_items(args) {
      const pageIndex = jsNum(has(args.pageIndex) ? args.pageIndex : 0, 'pageIndex');
      const type = has(args.type) ? String(args.type) : null;
      const script = `
        var doc = __requireDoc();
        var page = __page(doc, ${pageIndex});
        var items = page.allPageItems;
        var wanted = ${type ? jsStr(type) : 'null'};
        var out = [], shown = 0;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (wanted && it.constructor.name !== wanted) continue;
          var line = "[" + i + "] " + __describe(it);
          try { if (it.name && it.name.charAt(0) !== "<") line += " name=" + JSON_STR(it.name); } catch (e) {}
          try { if (it.parent && it.parent.constructor.name === "Group") line += " group=" + it.parent.id; } catch (e) {}
          out.push(line);
          shown++;
        }
        "=== PAGE ITEMS ON PAGE " + (${pageIndex} + 1) + " (" + shown + ") ===\\n" + (out.length ? out.join("\\n") : "(none)");
      `;
      return respond(await run(script), 'Page Items');
    },

    async delete_object(args) {
      const script = `
        var doc = __requireDoc();
        var it = ${objExpr(args)};
        var desc = __describe(it);
        it.remove();
        "Deleted: " + desc;
      `;
      return respond(await run(script), 'Delete Object');
    },

    async rotate_object(args) {
      const angle = jsNum(args.angle, 'angle');
      const ref = args.reference || 'center';
      if (!ANCHORS[ref]) throw new Error(`Invalid reference: ${ref} (use ${Object.keys(ANCHORS).join(', ')})`);
      const script = `
        var doc = __requireDoc();
        var it = ${objExpr(args)};
        var delta = ${args.absolute ? `${angle} - it.rotationAngle` : angle};
        it.transform(CoordinateSpaces.PASTEBOARD_COORDINATES, AnchorPoint.${ANCHORS[ref]},
          app.transformationMatrices.add({ counterclockwiseRotationAngle: delta }));
        "Rotated by " + __r(delta) + " deg about ${ref}: " + __describe(it);
      `;
      return respond(await run(script), 'Rotate Object');
    },

    async set_object_geometry(args) {
      const { x, y, width, height, rotation, shear } = args;
      if (![x, y, width, height, rotation, shear].some(has)) {
        throw new Error('Nothing to change: pass at least one of x, y, width, height, rotation, shear');
      }
      const script = `
        var doc = __requireDoc();
        var it = ${objExpr(args)};
        var oldRot = it.rotationAngle, oldShear = it.shearAngle;
        // Work on the unrotated frame, then re-apply rotation/shear about the centre
        if (oldRot !== 0) it.rotationAngle = 0;
        if (oldShear !== 0) it.shearAngle = 0;
        var b = it.geometricBounds; // top, left, bottom, right
        var left = ${has(x) ? jsNum(x, 'x') : 'b[1]'};
        var top = ${has(y) ? jsNum(y, 'y') : 'b[0]'};
        var w = ${has(width) ? jsNum(width, 'width') : '(b[3] - b[1])'};
        var h = ${has(height) ? jsNum(height, 'height') : '(b[2] - b[0])'};
        it.geometricBounds = [top, left, top + h, left + w];
        var newShear = ${has(shear) ? jsNum(shear, 'shear') : 'oldShear'};
        var newRot = ${has(rotation) ? jsNum(rotation, 'rotation') : 'oldRot'};
        if (newShear !== 0) it.shearAngle = newShear;
        if (newRot !== 0) it.rotationAngle = newRot;
        "Geometry updated: " + __describe(it) + (newShear !== 0 ? " shear=" + __r(it.shearAngle) : "");
      `;
      return respond(await run(script), 'Set Object Geometry');
    },

    async set_object_opacity(args) {
      const { opacity, blendMode, target = 'object' } = args;
      if (!has(opacity) && !has(blendMode)) throw new Error('Pass opacity and/or blendMode');
      const props = { object: 'transparencySettings', fill: 'fillTransparencySettings', stroke: 'strokeTransparencySettings' };
      if (!props[target]) throw new Error(`Invalid target: ${target} (use object, fill or stroke)`);
      if (has(opacity) && (jsNum(opacity, 'opacity') < 0 || opacity > 100)) throw new Error('opacity must be 0-100');
      const script = `
        var doc = __requireDoc();
        var it = ${objExpr(args)};
        var bs = it.${props[target]}.blendingSettings;
        ${has(opacity) ? `bs.opacity = ${jsNum(opacity, 'opacity')};` : ''}
        ${has(blendMode) ? `bs.blendMode = BlendMode.${jsEnum(blendMode, 'blendMode')};` : ''}
        "${target} transparency set: opacity=" + __r(bs.opacity) + " blendMode=" + bs.blendMode + " - " + __describe(it);
      `;
      return respond(await run(script), 'Set Object Opacity');
    },

    async set_object_overprint(args) {
      if (!has(args.fill) && !has(args.stroke)) throw new Error('Pass fill and/or stroke');
      const script = `
        var doc = __requireDoc();
        var it = ${objExpr(args)};
        try {
          ${has(args.fill) ? `it.overprintFill = ${args.fill ? 'true' : 'false'};` : ''}
          ${has(args.stroke) ? `it.overprintStroke = ${args.stroke ? 'true' : 'false'};` : ''}
        } catch (e) {
          throw new Error("Overprint is not available for this object (it needs a fill/stroke, and no transparency or blend mode). InDesign code " + e.number);
        }
        var ofill = "n/a", ostroke = "n/a"; // reading a property that does not apply (e.g. stroke of an unstroked object) throws
        try { ofill = it.overprintFill; } catch (e) {}
        try { ostroke = it.overprintStroke; } catch (e) {}
        "Overprint set: fill=" + ofill + " stroke=" + ostroke + " - " + __describe(it);
      `;
      return respond(await run(script), 'Set Object Overprint');
    },

    async set_text_frame_options(args) {
      const lines = [];
      const insetAll = has(args.inset) ? jsNum(args.inset, 'inset') : null;
      const sides = { insetTop: 0, insetLeft: 1, insetBottom: 2, insetRight: 3 };
      if (insetAll !== null || Object.keys(sides).some((k) => has(args[k]))) {
        lines.push('var ins = tf.textFramePreferences.insetSpacing; if (!(ins instanceof Array)) ins = [ins, ins, ins, ins]; ins = [ins[0], ins[1], ins[2], ins[3]];');
        if (insetAll !== null) lines.push(`ins = [${insetAll}, ${insetAll}, ${insetAll}, ${insetAll}];`);
        for (const [k, i] of Object.entries(sides)) {
          if (has(args[k])) lines.push(`ins[${i}] = ${jsNum(args[k], k)};`);
        }
        lines.push('tf.textFramePreferences.insetSpacing = ins;');
      }
      if (has(args.verticalAlignment)) {
        const map = { TOP: 'TOP_ALIGN', CENTER: 'CENTER_ALIGN', BOTTOM: 'BOTTOM_ALIGN', JUSTIFY: 'JUSTIFY_ALIGN' };
        if (!map[args.verticalAlignment]) throw new Error(`Invalid verticalAlignment: ${args.verticalAlignment}`);
        lines.push(`tf.textFramePreferences.verticalJustification = VerticalJustification.${map[args.verticalAlignment]};`);
      }
      if (has(args.columns)) lines.push(`tf.textFramePreferences.textColumnCount = ${jsNum(args.columns, 'columns')};`);
      if (has(args.columnGutter)) lines.push(`tf.textFramePreferences.textColumnGutter = ${jsNum(args.columnGutter, 'columnGutter')};`);
      if (has(args.autosize) || has(args.autosizeReference)) {
        const ok = ['OFF', 'HEIGHT_ONLY', 'WIDTH_ONLY', 'HEIGHT_AND_WIDTH', 'HEIGHT_AND_WIDTH_PROPORTIONALLY'];
        if (has(args.autosize) && !ok.includes(args.autosize)) throw new Error(`Invalid autosize: ${args.autosize}`);
        // Turning auto-size on keeps the frame's top-left corner unless another point is asked for
        const refKey = has(args.autosizeReference) ? args.autosizeReference : (args.autosize !== 'OFF' ? 'top-left' : null);
        if (refKey) {
          const ref = AUTOSIZE_REFERENCES[refKey];
          if (!ref) throw new Error(`Invalid autosizeReference: ${refKey} (use ${Object.keys(AUTOSIZE_REFERENCES).join(', ')})`);
          // the reference point goes first: InDesign resizes as soon as the type is set
          lines.push(`tf.textFramePreferences.autoSizingReferencePoint = AutoSizingReferenceEnum.${ref};`);
        }
        if (has(args.autosize)) lines.push(`tf.textFramePreferences.autoSizingType = AutoSizingTypeEnum.${args.autosize};`);
      }
      if (has(args.textWrap)) {
        const map = { NONE: 'NONE', BOUNDING_BOX: 'BOUNDING_BOX_TEXT_WRAP', CONTOUR: 'CONTOUR', JUMP_OBJECT: 'JUMP_OBJECT_TEXT_WRAP', NEXT_COLUMN: 'NEXT_COLUMN_TEXT_WRAP' };
        if (!map[args.textWrap]) throw new Error(`Invalid textWrap: ${args.textWrap}`);
        lines.push(`tf.textWrapPreferences.textWrapMode = TextWrapModes.${map[args.textWrap]};`);
      }
      if (has(args.textWrapOffset)) {
        const o = jsNum(args.textWrapOffset, 'textWrapOffset');
        lines.push(`tf.textWrapPreferences.textWrapOffset = [${o}, ${o}, ${o}, ${o}];`);
      }
      if (lines.length === 0) throw new Error('No options given');
      const script = `
        var doc = __requireDoc();
        var tf = ${objExpr(args)};
        ${lines.join('\n        ')}
        "Options updated: " + __describe(tf);
      `;
      return respond(await run(script), 'Set Text Frame Options');
    },

    async group_objects(args) {
      if (!Array.isArray(args.ids) || args.ids.length < 2) throw new Error('ids must list at least 2 object ids');
      const ids = args.ids.map((v) => jsNum(v, 'id'));
      const script = `
        var doc = __requireDoc();
        var ids = ${jsJson(ids)};
        var items = [];
        for (var i = 0; i < ids.length; i++) {
          var it = __findById(doc, ids[i]);
          if (!it) throw new Error("No object with id " + ids[i]);
          items.push(it);
        }
        var spread = items[0].parent;
        try { while (spread && !(spread instanceof Spread) && !(spread instanceof MasterSpread)) spread = spread.parent; } catch (e) {}
        for (var k = 1; k < items.length; k++) {
          var sp = items[k].parent;
          try { while (sp && !(sp instanceof Spread) && !(sp instanceof MasterSpread)) sp = sp.parent; } catch (e) {}
          if (sp !== spread) throw new Error("Objects " + ids[0] + " and " + ids[k] + " are on different spreads: group the objects of one spread");
        }
        var g = doc.groups.add(items);
        ${has(args.name) ? `g.name = ${jsStr(args.name)};` : ''}
        "Grouped " + items.length + " objects: " + __describe(g)${has(args.name) ? ` + " name=" + g.name` : ''};
      `;
      return respond(await run(script), 'Group Objects');
    },

    async name_object(args) {
      const script = `
        var doc = __requireDoc();
        var it = ${objExpr(args)};
        it.name = ${jsStr(args.name)};
        "Named \\"" + it.name + "\\": " + __describe(it);
      `;
      return respond(await run(script), 'Name Object');
    },

    async ungroup(args) {
      const script = `
        var doc = __requireDoc();
        var g = ${objExpr(args)};
        if (g.constructor.name !== "Group") throw new Error("Object " + g.id + " is a " + g.constructor.name + ", not a group");
        var ids = [];
        for (var i = 0; i < g.pageItems.length; i++) ids.push(g.pageItems[i].id);
        g.ungroup();
        "Ungrouped into " + ids.length + " objects, ids: " + ids.join(", ");
      `;
      return respond(await run(script), 'Ungroup');
    },

    async apply_character_style_to_range(args) {
      const { styleName, startIndex, endIndex, matchText } = args;
      const byText = has(matchText) && String(matchText).length > 0;
      if (!byText && !(has(startIndex) && has(endIndex))) {
        throw new Error('Pass startIndex and endIndex, or matchText');
      }
      const script = `
        var doc = __requireDoc();
        var frame = ${frameExpr(args)};
        var style = __cstyle(doc, ${jsStr(styleName)});
        var story = frame.parentStory;
        var total = story.characters.length, applied = 0;
        ${byText ? `
          var needle = ${jsStr(matchText)}, hay = story.contents, from = 0, at;
          while ((at = hay.indexOf(needle, from)) !== -1) {
            story.characters.itemByRange(at, at + needle.length - 1).appliedCharacterStyle = style;
            applied++;
            from = at + needle.length;
          }
          if (applied === 0) throw new Error("Text not found in frame " + frame.id + ": " + needle);
        ` : `
          var a = ${jsNum(startIndex, 'startIndex')}, b = ${jsNum(endIndex, 'endIndex')};
          if (a < 0 || b < a || b >= total) throw new Error("Invalid range " + a + "-" + b + " (the story has " + total + " characters, 0-based, inclusive)");
          story.characters.itemByRange(a, b).appliedCharacterStyle = style;
          applied = 1;
        `}
        "Character style " + ${jsStr(styleName)} + " applied to " + applied + " range(s) in frame id=" + frame.id;
      `;
      return respond(await run(script), 'Apply Character Style');
    },

    async clear_overrides(args) {
      const ranged = has(args.startIndex) && has(args.endIndex);
      const script = `
        var doc = __requireDoc();
        var frame = ${frameExpr(args)};
        var story = frame.parentStory;
        var target;
        ${ranged ? `
          var a = ${jsNum(args.startIndex, 'startIndex')}, b = ${jsNum(args.endIndex, 'endIndex')};
          if (a < 0 || b < a || b >= story.characters.length) throw new Error("Invalid range " + a + "-" + b + " (the story has " + story.characters.length + " characters)");
          target = story.characters.itemByRange(a, b);
        ` : `
          target = story.texts[0];
        `}
        target.clearOverrides();
        "Overrides cleared in frame id=" + frame.id + ${ranged ? '" (range)"' : '" (whole story)"'};
      `;
      return respond(await run(script), 'Clear Overrides');
    },

    async list_open_documents() {
      const script = `
        var out = [];
        var active = app.documents.length > 0 ? app.activeDocument : null;
        for (var i = 0; i < app.documents.length; i++) {
          var d = app.documents[i];
          var path = "unsaved";
          if (__hasFile(d)) path = d.fullName.fsName;
          out.push("[" + i + "] " + d.name + (active && d.name === active.name && d.id === active.id ? " (ACTIVE)" : "") +
                   " pages=" + d.pages.length + " modified=" + d.modified + " path=" + path);
        }
        "=== OPEN DOCUMENTS (" + app.documents.length + ") ===\\n" + (out.length ? out.join("\\n") : "(none)");
      `;
      return respond(await run(script), 'Open Documents');
    },

    async activate_document(args) {
      const script = `
        if (app.documents.length === 0) throw new Error("No document open");
        var d = app.documents.itemByName(${jsStr(args.name)});
        if (!d.isValid) throw new Error("Document not found: " + ${jsStr(args.name)});
        app.activeDocument = d;
        "Active document: " + app.activeDocument.name;
      `;
      return respond(await run(script), 'Activate Document');
    },

    async convert_rgb_to_cmyk(args) {
      let rgb = args.rgb;
      if (has(args.hex)) rgb = ctx.parseHex(args.hex);
      if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some((v) => !Number.isFinite(Number(v)) || v < 0 || v > 255)) {
        throw new Error('Pass rgb as [R,G,B] (0-255) or hex as #RRGGBB');
      }
      rgb = rgb.map(Number);
      const method = args.conversion || 'profile';
      if (method === 'simple') {
        const cmyk = ctx.rgbToCmyk(...rgb);
        return respond(`RGB ${rgb.join(',')} -> CMYK ${cmyk.join(',')} (C,M,Y,K in %). Simple formula without a colour profile: hues drift (greens toward blue); use conversion "profile" for print work.`, 'RGB to CMYK');
      }
      const raw = await run(`
        var doc = __requireDoc();
        var cmyk = __cmsCmyk(doc, ${jsJson(rgb)});
        var back = __cmsRgb(doc, cmyk);
        "CMYK=" + cmyk.join(",") + ";BACK=" + back.join(",") + ";CMYKPROFILE=" + doc.cmykProfile + ";RGBPROFILE=" + doc.rgbProfile;
      `);
      const field = (k) => {
        const m = String(raw).match(new RegExp(`${k}=([^;]*)`));
        if (!m) throw new Error(`Unexpected reply from InDesign while converting the colour: ${String(raw).slice(0, 120)}`);
        return m[1];
      };
      const cmyk = field('CMYK').split(',').map(Number);
      const back = field('BACK').split(',').map(Number);
      const de = deltaE(rgb, back);
      const verdict = de < 3 ? 'reproduced accurately' : de < 8 ? 'slightly different after conversion' : 'OUTSIDE the print gamut: the nearest printable colour is noticeably different';
      return respond(`RGB ${rgb.join(',')} (${toHex(rgb)}) -> CMYK ${cmyk.join(',')} (C,M,Y,K in %)\nColour-managed: ${field('RGBPROFILE')} -> ${field('CMYKPROFILE')} (the profiles of the active document)\nAs printed it looks like ${toHex(back)} (delta E ${de.toFixed(1)}): ${verdict}.`, 'RGB to CMYK');
    },
  };

  const zOrder = {
    send_to_back: ['sendToBack', 'Send to Back'],
    bring_to_front: ['bringToFront', 'Bring to Front'],
    send_backward: ['sendBackward', 'Send Backward'],
    bring_forward: ['bringForward', 'Bring Forward'],
  };
  for (const [tool, [method, label]] of Object.entries(zOrder)) {
    handlers[tool] = async (args) => {
      const script = `
        var doc = __requireDoc();
        var it = ${objExpr(args)};
        it.${method}();
        "${label}: " + __describe(it);
      `;
      return respond(await run(script), label);
    };
  }

  return { definitions, handlers };
}
