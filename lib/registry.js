// Tool registry: the one place that knows every tool.
//
// Each tool module returns { definitions, handlers }. A definition holds the MCP schema plus
// what the server needs to know about the tool:
//   modifies   true when the tool changes the open document (drives the workflow reminder)
//   paths, destructive, overwrites   what the safety policy checks (lib/policy.js)
// The registry checks that every definition has its handler (and the reverse), lists the tools
// as MCP expects them, validates arguments against the schema, applies the policy and calls
// the handler.

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

const SERVER_FIELDS = ['modifies', 'paths', 'destructive', 'overwrites'];
const CONFIRM = { type: 'boolean', description: 'Confirm an action that deletes or overwrites (only when the user asked for it)', default: false };

export function createRegistry(modules, { policy = null } = {}) {
  const tools = new Map();
  for (const m of modules) {
    for (const def of m.definitions) {
      if (tools.has(def.name)) throw new Error(`Tool ${def.name} is defined twice`);
      if (typeof def.modifies !== 'boolean') throw new Error(`Tool ${def.name} must declare modifies: true | false`);
      const handler = m.handlers[def.name];
      if (typeof handler !== 'function') throw new Error(`Tool ${def.name} has no handler`);
      for (const key of def.paths || []) if (!def.inputSchema?.properties?.[key]) throw new Error(`Tool ${def.name}: path "${key}" is not in its schema`);
      // a tool that can need a confirmation always advertises the parameter
      if ((def.destructive || def.overwrites) && !def.inputSchema.properties.confirmDestructive) {
        def.inputSchema = { ...def.inputSchema, properties: { ...def.inputSchema.properties, confirmDestructive: CONFIRM } };
      }
      tools.set(def.name, { def, handler });
    }
    for (const name of Object.keys(m.handlers)) {
      if (!m.definitions.some((d) => d.name === name)) throw new Error(`Handler ${name} has no definition`);
    }
  }

  const listed = [...tools.values()].map(({ def }) => {
    const out = { ...def };
    for (const f of SERVER_FIELDS) delete out[f];
    return out;
  });

  const get = (name) => {
    const t = tools.get(name);
    if (!t) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    return t;
  };

  return {
    names: () => [...tools.keys()],
    list: () => listed,
    definition: (name) => get(name).def,
    // Validate, apply the safety policy, then run the handler; returns the MCP result
    async call(name, args) {
      const { def, handler } = get(name);
      const valid = validateArguments(def, args);
      return handler(policy ? policy.apply(def, valid) : valid);
    },
  };
}

// Check tool arguments against the tool's inputSchema before any script is generated.
// Numbers (also numeric strings), booleans, strings, arrays and enums are type-checked, so
// a malformed value can never end up as code in a generated script.
export function validateArguments(def, args) {
  const toolName = def.name;
  const schema = def.inputSchema || {};
  const input = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === null) {
      throw new McpError(ErrorCode.InvalidParams, `Missing required parameter "${key}" for ${toolName}`);
    }
  }
  const bad = (key, expected, value) => {
    throw new McpError(ErrorCode.InvalidParams, `Invalid parameter "${key}" for ${toolName}: expected ${expected}, got ${JSON.stringify(value)}`);
  };
  const check = (key, spec, value) => {
    if (value === undefined || value === null || !spec) return value;
    switch (spec.type) {
      case 'number': {
        const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        if (typeof n !== 'number' || !Number.isFinite(n)) bad(key, 'a number', value);
        return n;
      }
      case 'boolean':
        if (typeof value !== 'boolean') bad(key, 'true or false', value);
        return value;
      case 'string':
        if (typeof value !== 'string') bad(key, 'a string', value);
        if (spec.enum && !spec.enum.includes(value)) bad(key, `one of ${spec.enum.join(', ')}`, value);
        return value;
      case 'array':
        if (!Array.isArray(value)) bad(key, 'an array', value);
        return spec.items ? value.map((v, i) => check(`${key}[${i}]`, spec.items, v)) : value;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) bad(key, 'an object', value);
        return value;
      default:
        return value;
    }
  };
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    if (key in input) input[key] = check(key, spec, input[key]);
  }
  return input;
}
