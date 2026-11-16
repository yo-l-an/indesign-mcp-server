// Tool context: everything a tool module may use, and nothing else.
//
//   createXTools(ctx) -> { definitions, handlers }
//
//   ctx.run(script)              run ExtendScript in InDesign (lib/executor.js); the last expression
//                                comes back as a string, a thrown error rejects
//   ctx.respond(text, operation) the MCP result "<operation>: <text>"
//   ctx.resolvePath(p)           check a path the tool computes itself (arguments declared in
//                                `paths` are already resolved by the registry, lib/policy.js)
//   ctx.scriptDir                the executor's temp folder (files InDesign writes for us)
//   ctx.workflow                 session state of the review workflow (prepare_edit, backups...)
//   ctx.jsStr / jsJson / jsNum / jsEnum, frameExpr, textFrameAcquire, toInDesignText, grepSteps
//                                script building (lib/script-runtime.js)
//   ctx.parseHex / rgbToCmyk     colour maths (lib/color.js)
//
// Modules written as methods (`this.jsStr(...)`) build on it with Object.create(ctx).

import * as runtime from './script-runtime.js';
import { parseHex, rgbToCmyk } from './color.js';

export const has = (v) => v !== undefined && v !== null;

export function createToolContext({ executor, policy, workflow }) {
  return {
    run: (script) => executor.run(script),
    respond: (result, operation = 'Operation') => ({ content: [{ type: 'text', text: `${operation}: ${result}` }] }),
    resolvePath: (p, label) => policy.resolvePath(p, label),
    get scriptDir() { return executor.tempDir; },
    workflow,
    jsStr: runtime.jsStr,
    jsJson: runtime.jsJson,
    jsNum: runtime.jsNum,
    jsEnum: runtime.jsEnum,
    frameExpr: runtime.frameExpr,
    textFrameAcquire: runtime.textFrameAcquire,
    toInDesignText: runtime.toInDesignText,
    grepSteps: runtime.grepSteps,
    parseHex,
    rgbToCmyk,
  };
}
