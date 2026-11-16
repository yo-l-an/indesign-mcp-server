#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jsStr, jsJson, jsNum, jsEnum } from './lib/script-runtime.js';
import { createExecutor } from './lib/executor.js';
import { createExtraTools } from './tools/extra-tools.js';
import { createVectorTools } from './tools/vector-tools.js';
import { createGraphicsTools } from './tools/graphics-tools.js';
import { createResourceTools } from './tools/resource-tools.js';
import { createReviewTools } from './tools/review-tools.js';
import { createSourceTools } from './tools/source-tools.js';
import { createDocumentTools } from './tools/document-tools.js';
import { createTextTools } from './tools/text-tools.js';
import { createStyleTools } from './tools/style-tools.js';
import { createShapeTools } from './tools/shape-tools.js';
import { createExportTools } from './tools/export-tools.js';
import { createRegistry } from './lib/registry.js';
import { createPolicy } from './lib/policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; }
})();

export class InDesignMCPServer {
  constructor({ executor } = {}) {
    this.executor = executor || createExecutor();
    this.server = new Server(
      {
        name: 'indesign-server-complete',
        version: PACKAGE_VERSION,
      },
      {
        capabilities: {
          tools: { listChanged: true },
        },
        instructions: 'Surgical InDesign corrections for a project manager. Before the first change to a document in a session, read get_usage_guide: the five-step workflow (scope, prepare_edit, change by id, review_compare, close), page names, backups. Client files (commented PDF, Word brief or feedback): read_feedback / read_source_document, then triage with the project manager before changing anything. Backups are permanent: delete them only on the user\'s explicit request.',
      }
    );

    // Which files tools may touch and when a call must be confirmed (lib/policy.js)
    this.policy = createPolicy();

    // Every tool lives in a module that declares its schema, traits and handler (lib/registry.js)
    this.workflow = { guideRead: false, prepared: false, reminded: false, backups: new Set(), lastSnapshot: null };
    this.registry = createRegistry([
      createReviewTools(this), createSourceTools(this),
      createDocumentTools(this), createTextTools(this), createStyleTools(this), createShapeTools(this), createExportTools(this),
      createExtraTools(this), createVectorTools(this), createGraphicsTools(this), createResourceTools(this),
    ], { policy: this.policy });
    this.setupToolHandlers();
  }

  // Computed paths (backup folders, review files) go through the same policy as tool arguments
  validateFilePath(filePath) {
    return this.policy.resolvePath(filePath);
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.registry.list() }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        return this.withWorkflowReminder(name, await this.registry.call(name, args));
      } catch (error) {
        // Keep protocol errors (invalid params, unknown tool) as they are: wrapping them again
        // turned them into InternalError and doubled the "MCP error -326xx:" prefix
        if (error instanceof McpError) throw error;
        throw new McpError(ErrorCode.InternalError, `Error executing tool ${name}: ${error.message}`);
      }
    });
  }

  // The first tool that modifies the document without prepare_edit in this session gets a
  // one-line reminder (INDESIGN_WORKFLOW_REMINDERS=0 turns it off).
  withWorkflowReminder(name, result) {
    const w = this.workflow;
    if (w.prepared || w.reminded || process.env.INDESIGN_WORKFLOW_REMINDERS === '0' || !this.registry.definition(name).modifies || !result?.content) return result;
    w.reminded = true;
    return {
      ...result,
      content: [...result.content, { type: 'text', text: 'Workflow: no prepare_edit in this session. For an existing document, call prepare_edit({ pages, reason }) before changing it (backup + before snapshot), then review_compare.' }],
    };
  }

  // =================== SCRIPT EXECUTION (lib/executor.js) ===================
  // Run ExtendScript in InDesign; returns the script's last expression as a string and throws
  // when the script throws. Tests inject an executor with an in-memory adapter.
  executeInDesignScript(script) { return this.executor.run(script); }
  get scriptDir() { return this.executor.tempDir; }
  get appName() { return this.executor.appName; }

  // Embed a value in generated ExtendScript as a safe string literal
  jsStr(value) { return jsStr(value); }
  jsJson(value) { return jsJson(value); }
  // Validate a value that is spliced into generated code as a bare identifier (e.g. an enum name)
  jsEnum(value, label) { return jsEnum(value, label); }
  // Coerce a value to a finite number for embedding in generated code
  jsNum(value, label) { return jsNum(value, label); }

  // JS expression that resolves a text frame from frameId, or pageIndex + frameIndex
  frameExpr(args, docVar = 'doc') {
    const num = (v, label) => (v === undefined || v === null ? 'null' : this.jsNum(v, label));
    return `__textFrame(${docVar}, ${num(args.frameId, 'frameId')}, ${num(args.pageIndex, 'pageIndex')}, ${num(args.frameIndex, 'frameIndex')})`;
  }

  // Convert user text to InDesign text: "\n" -> paragraph (\r) or forced line break (U+2028); "<br>" -> forced line break
  toInDesignText(content, lineBreak = 'paragraph') {
    if (lineBreak !== 'paragraph' && lineBreak !== 'forced') {
      throw new Error(`Invalid lineBreak: ${lineBreak} (use "paragraph" or "forced")`);
    }
    // In InDesign text a paragraph break is CR (13) and a forced line break (Shift+Enter) is LF (10).
    // (U+2028 is NOT a line break there; it is stored as an ordinary, space-like character.)
    const FORCED = '\u0000';
    return String(content)
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, FORCED)
      .replace(/\n/g, lineBreak === 'forced' ? FORCED : '\r')
      .replace(new RegExp(FORCED, 'g'), '\n');
  }

  // Statement block that sets `textFrame`: the selected frame, or frameId / pageIndex + frameIndex
  textFrameAcquire(args) {
    if (args.useSelectedFrame) {
      return `var textFrame;
          if (app.selection.length === 0 || app.selection[0].constructor.name !== "TextFrame") {
            throw new Error("No text frame selected. Please select a text frame first.");
          }
          textFrame = app.selection[0];`;
    }
    return `var textFrame = ${this.frameExpr(args)};`;
  }

  // Build ExtendScript that runs GREP find/change steps on `story`, keeping all formatting.
  // steps: [{ find, change, label }] (label uses %n for the count)
  grepSteps(steps) {
    return steps.map((st) => `
              n = __grep(story, ${this.jsStr(st.find)}, ${this.jsStr(st.change)});
              if (n > 0) { changes += n; changeLog += ${this.jsStr('✓ ' + st.label)}.replace("%n", n) + "\\n"; }`).join('');
  }

  formatResponse(result, operation = "Operation") {
    return {
      content: [
        {
          type: 'text',
          text: `${operation}: ${result}`,
        },
      ],
    };
  }

  // =================== DOCUMENT MANAGEMENT ===================

  // =================== PAGE MANAGEMENT ===================

  // =================== TEXT MANAGEMENT ===================
  
  // =================== STYLE MANAGEMENT ===================

  // =================== COLOR MANAGEMENT ===================
  // Naive RGB (0-255) -> CMYK (0-100) WITHOUT a colour profile. Hues drift (greens toward blue), so it is only
  // used when conversion: "simple" is requested; the default is InDesign's colour management (see __cmsCmyk).
  rgbToCmyk(r, g, b) {
    const rr = r / 255, gg = g / 255, bb = b / 255;
    const k = 1 - Math.max(rr, gg, bb);
    if (k >= 1) return [0, 0, 0, 100];
    const c = (1 - rr - k) / (1 - k);
    const m = (1 - gg - k) / (1 - k);
    const y = (1 - bb - k) / (1 - k);
    return [c, m, y, k].map((v) => Math.round(v * 1000) / 10);
  }

  parseHex(hex) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) throw new Error(`Invalid hex colour: ${hex} (expected #RRGGBB)`);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // =================== EXPORT FUNCTIONS ===================

  // =================== UTILITIES ===================

  // =================== TABLE MANAGEMENT (Simplified implementations) ===================

  // =================== LAYER MANAGEMENT (Simplified implementations) ===================

  // =================== ADDITIONAL UTILITIES ===================

  async run() {
    const transport = new StdioServerTransport();
    // Tell the client to re-read the tool list after every (re)start, so cached schemas cannot go stale
    this.server.oninitialized = () => {
      this.server.sendToolListChanged().catch(() => {});
    };
    await this.server.connect(transport);
    console.error('Complete InDesign MCP server running on stdio');
  }
}

// Only start the server when run directly (tests import the class)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) {
  const server = new InDesignMCPServer();
  server.run().catch(console.error);
}