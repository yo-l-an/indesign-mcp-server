// Images and basic shapes: place_image, rectangles, ellipses.
//
// Moved out of index.js: each tool declares its schema, whether it modifies the document
// (`modifies`) and its handler in this one file. Handlers reach the tool context (run, respond,
// jsStr, jsNum, frameExpr…, lib/tool-context.js) through `this`.

export function createShapeTools(ctx) {
  const definitions = [
    {
      name: 'place_image',
      modifies: true,
      paths: ['imagePath'],
      description: 'Place an image into a new frame (mm). Give width and height for a fixed frame, only width or height to keep the aspect ratio, or neither to use the image size. Returns the frame id.',
      inputSchema: {
        type: 'object',
        properties: {
          imagePath: { type: 'string', description: 'Path to the image file' },
          x: { type: 'number', description: 'X position in mm', default: 10 },
          y: { type: 'number', description: 'Y position in mm', default: 10 },
          width: { type: 'number', description: 'Frame width in mm' },
          height: { type: 'number', description: 'Frame height in mm' },
          pageIndex: { type: 'number', description: 'Page index (0-based)', default: 0 },
          fitOption: { type: 'string', enum: ['FILL_PROPORTIONALLY', 'PROPORTIONALLY', 'CONTENT_TO_FRAME', 'FRAME_TO_CONTENT', 'CENTER_CONTENT', 'NONE'], description: 'FILL_PROPORTIONALLY = crop to fill the frame; PROPORTIONALLY = fit inside; NONE = keep 100%', default: 'PROPORTIONALLY' },
          contentOffsetX: { type: 'number', description: 'Move the image inside the frame by this many mm (after fitting)' },
          contentOffsetY: { type: 'number', description: 'Move the image inside the frame by this many mm (after fitting)' },
          contentScale: { type: 'number', description: 'Scale the image content to this percentage (after fitting)' },
          createFrame: { type: 'boolean', description: 'Create a frame first (false = place at x,y with its own size)', default: true },
        },
        required: ['imagePath'],
      },
    },
    {
      name: 'create_rectangle',
      modifies: true,
      description: 'Create a rectangle shape',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X position in mm' },
          y: { type: 'number', description: 'Y position in mm' },
          width: { type: 'number', description: 'Width in mm' },
          height: { type: 'number', description: 'Height in mm' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          fillColor: { type: 'string', description: 'Fill color (RGB hex or swatch name)' },
          strokeColor: { type: 'string', description: 'Stroke color' },
          strokeWidth: { type: 'number', description: 'Stroke width in points', default: 1 },
          cornerRadius: { type: 'number', description: 'Corner radius in mm', default: 0 },
        },
        required: ['x', 'y', 'width', 'height'],
      },
    },
    {
      name: 'create_ellipse',
      modifies: true,
      description: 'Create an ellipse shape',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X position in mm' },
          y: { type: 'number', description: 'Y position in mm' },
          width: { type: 'number', description: 'Width in mm' },
          height: { type: 'number', description: 'Height in mm' },
          pageIndex: { type: 'number', description: 'Page index', default: 0 },
          fillColor: { type: 'string', description: 'Fill color' },
          strokeColor: { type: 'string', description: 'Stroke color' },
          strokeWidth: { type: 'number', description: 'Stroke width in points', default: 1 },
        },
        required: ['x', 'y', 'width', 'height'],
      },
    },
  ];

  const self = Object.assign(Object.create(ctx), {
    async placeImage(args) {
      const {
        imagePath, x = 10, y = 10, width, height, pageIndex = 0,
        fitOption = 'PROPORTIONALLY', createFrame = true,
        contentOffsetX, contentOffsetY, contentScale
      } = args;

      // imagePath is already resolved and checked by the policy (lib/policy.js)
      const validatedPath = imagePath;
      const fits = {
        FILL_PROPORTIONALLY: 'FitOptions.FILL_PROPORTIONALLY',
        PROPORTIONALLY: 'FitOptions.PROPORTIONALLY',
        CONTENT_TO_FRAME: 'FitOptions.CONTENT_TO_FRAME',
        FRAME_TO_CONTENT: 'FitOptions.FRAME_TO_CONTENT',
        CENTER_CONTENT: 'FitOptions.CENTER_CONTENT',
        NONE: null,
      };
      if (!(fitOption in fits)) {
        throw new Error(`Invalid fitOption: ${fitOption} (use ${Object.keys(fits).join(', ')})`);
      }
      const nx = this.jsNum(x, 'x');
      const ny = this.jsNum(y, 'y');
      const pageIdx = this.jsNum(pageIndex, 'pageIndex');
      const w = width !== undefined ? this.jsNum(width, 'width') : null;
      const h = height !== undefined ? this.jsNum(height, 'height') : null;

      const script = `
        var doc = __requireDoc();
        var page = __page(doc, ${pageIdx});
        var imageFile = File(${this.jsStr(validatedPath)});
        if (!imageFile.exists) throw new Error("Image file not found: " + imageFile.fsName);
      
        var rect;
        ${createFrame ? `
          rect = page.rectangles.add();
          var fw = ${w !== null ? w : (h !== null ? h : 50)}, fh = ${h !== null ? h : (w !== null ? w : 50)};
          rect.geometricBounds = [${ny}, ${nx}, ${ny} + fh, ${nx} + fw];
          try {
            rect.place(imageFile);
          } catch (pe) {
            rect.remove();
            throw pe;
          }
          ${(w !== null) !== (h !== null) || (w === null && h === null) ? `
            // Only one dimension (or none) given: size the frame from the image aspect ratio
            rect.fit(FitOptions.FRAME_TO_CONTENT);
            var nb = rect.geometricBounds, iw = nb[3] - nb[1], ih = nb[2] - nb[0];
            ${w !== null ? `
              rect.geometricBounds = [${ny}, ${nx}, ${ny} + ${w} * ih / iw, ${nx} + ${w}];
              rect.fit(FitOptions.CONTENT_TO_FRAME);
            ` : h !== null ? `
              rect.geometricBounds = [${ny}, ${nx}, ${ny} + ${h}, ${nx} + ${h} * iw / ih];
              rect.fit(FitOptions.CONTENT_TO_FRAME);
            ` : `
              rect.geometricBounds = [${ny}, ${nx}, ${ny} + ih, ${nx} + iw];
              rect.fit(FitOptions.CONTENT_TO_FRAME);   // move the content with the frame
            `}
          ` : `
            ${fits[fitOption] ? `rect.fit(${fits[fitOption]});` : ''}
          `}
        ` : `
          var placed = page.place(imageFile, [${nx}, ${ny}]);
          rect = placed[0].parent;
        `}
      
        ${contentScale !== undefined ? `
          rect.graphics[0].horizontalScale = ${this.jsNum(contentScale, 'contentScale')};
          rect.graphics[0].verticalScale = ${this.jsNum(contentScale, 'contentScale')};
        ` : ''}
        ${contentOffsetX !== undefined || contentOffsetY !== undefined ? `
          rect.graphics[0].move(undefined, [${contentOffsetX !== undefined ? this.jsNum(contentOffsetX, 'contentOffsetX') : 0}, ${contentOffsetY !== undefined ? this.jsNum(contentOffsetY, 'contentOffsetY') : 0}]);
        ` : ''}
      
        "Image placed: " + imageFile.name + " - " + __describe(rect);
      `;

      const result = await this.run(script);
      return this.respond(result, "Place Image");
    },

    async createRectangle(args) {
      const { x, y, width, height, pageIndex = 0, fillColor, strokeColor, strokeWidth = 1, cornerRadius = 0 } = args;
      return this._createShape('rectangles', 'Rectangle', args);
    },

    async createEllipse(args) {
      return this._createShape('ovals', 'Ellipse', args);
    },

    async _createShape(collection, label, args) {
      const { x, y, width, height, pageIndex = 0, fillColor, strokeColor, strokeWidth = 1, cornerRadius = 0 } = args;
      const nx = this.jsNum(x, 'x');
      const ny = this.jsNum(y, 'y');
      const nw = this.jsNum(width, 'width');
      const nh = this.jsNum(height, 'height');
      const pageIdx = this.jsNum(pageIndex, 'pageIndex');
      const radius = collection === 'rectangles' ? this.jsNum(cornerRadius, 'cornerRadius') : 0;

      const script = `
        var doc = __requireDoc();
        var page = __page(doc, ${pageIdx});
        ${fillColor ? `var fill = __swatch(doc, ${this.jsStr(fillColor)});` : ''}
        ${strokeColor ? `var stroke = __swatch(doc, ${this.jsStr(strokeColor)});` : ''}
        var shape = page.${collection}.add();
        shape.geometricBounds = [${ny}, ${nx}, ${ny + nh}, ${nx + nw}];
        ${radius > 0 ? `shape.topLeftCornerRadius = shape.topRightCornerRadius = shape.bottomLeftCornerRadius = shape.bottomRightCornerRadius = ${radius}; shape.topLeftCornerOption = shape.topRightCornerOption = shape.bottomLeftCornerOption = shape.bottomRightCornerOption = CornerOptions.ROUNDED_CORNER;` : ''}
        ${fillColor ? 'shape.fillColor = fill;' : ''}
        ${strokeColor ? `shape.strokeColor = stroke; shape.strokeWeight = "${this.jsNum(strokeWidth, 'strokeWidth')}pt";` : ''}
        "${label} created: " + __describe(shape);
      `;

      const result = await this.run(script);
      return this.respond(result, `Create ${label}`);
    },
  });

  const handlers = {
    place_image: (args) => self.placeImage(args),
    create_rectangle: (args) => self.createRectangle(args),
    create_ellipse: (args) => self.createEllipse(args),
  };

  return { definitions, handlers };
}
