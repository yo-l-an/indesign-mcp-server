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
import { createNotesTools } from './tools/notes-tools.js';
import { createLayoutTools } from './tools/layout-tools.js';
import { createMasterTools } from './tools/master-tools.js';
import { createViewTools } from './tools/view-tools.js';
import { createScriptTools } from './tools/script-tools.js';
import { createAlignTools } from './tools/align-tools.js';
import { createTypoTools } from './tools/typo-tools.js';
import { createRegistry } from './lib/registry.js';
import { createPolicy } from './lib/policy.js';
import { createToolContext } from './lib/tool-context.js';

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
        instructions: 'Surgical InDesign corrections for a project manager. Before the first change to a document in a session, read get_usage_guide: the five-step workflow (scope, prepare_edit, change by id, review_compare, close), page names, backups. Building a layout (new document, grids, masters, alternate layouts): get_usage_guide topic "layout". Client files (commented PDF, Word brief or feedback): read_feedback / read_source_document, then triage with the project manager before changing anything. Backups are permanent: delete them only on the user\'s explicit request. A bug, a missing feature, a better way found, or a fix you made to the server files: add_improvement_note (NOTES.md for the author).',
      }
    );

    // Which files tools may touch and when a call must be confirmed (lib/policy.js)
    this.policy = createPolicy();

    // Every tool lives in a module that declares its schema, traits and handler (lib/registry.js)
    this.workflow = { guideRead: false, prepared: false, reminded: false, backups: new Set(), lastSnapshot: null, snapshots: new Map(), createdDocIds: new Set() };
    // Tool modules see only this context, never the server (lib/tool-context.js)
    const ctx = createToolContext({ executor: this.executor, policy: this.policy, workflow: this.workflow });
    this.registry = createRegistry([
      createReviewTools(ctx), createSourceTools(ctx), createNotesTools(),
      createDocumentTools(ctx), createTextTools(ctx), createStyleTools(ctx), createShapeTools(ctx), createExportTools(ctx),
      createExtraTools(ctx), createVectorTools(ctx), createGraphicsTools(ctx), createResourceTools(ctx),
      createLayoutTools(ctx), createMasterTools(ctx), createViewTools(ctx), createScriptTools(ctx), createAlignTools(ctx), createTypoTools(ctx),
    ], { policy: this.policy });
    this.setupToolHandlers();
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

  // The first tool that modifies a document with no snapshot (prepare_edit or the automatic one)
  // gets a one-line reminder (INDESIGN_WORKFLOW_REMINDERS=0 turns it off).
  withWorkflowReminder(name, result) {
    const w = this.workflow;
    if (w.prepared || w.reminded || process.env.INDESIGN_WORKFLOW_REMINDERS === '0' || !this.registry.definition(name).modifies || !result?.content) return result;
    w.reminded = true;
    return {
      ...result,
      content: [...result.content, { type: 'text', text: 'Workflow: no snapshot for this change (a document built in this session, or INDESIGN_AUTO_SNAPSHOT=0). To review changes to an existing document, prepare_edit({ pages, reason }) first, then review_compare.' }],
    };
  }

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