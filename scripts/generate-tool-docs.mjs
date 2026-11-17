#!/usr/bin/env node
// Regenerates the tool list in docs/TOOLS.md from the server's own tool schemas.
//   npm run docs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = [
  ['Workflow, review and backups', ['get_usage_guide', 'prepare_edit', 'find_text', 'review_compare', 'backup_document', 'list_backups', 'restore_backup']],
  ['Client files (brief and feedback)', ['read_source_document', 'read_feedback']],
  ['Documents', ['get_document_info', 'create_document', 'open_document', 'save_document', 'close_document', 'list_open_documents', 'activate_document', 'view_document', 'zoom_to_page']],
  ['Pages', ['add_page', 'delete_page', 'duplicate_page', 'move_page', 'set_page_size', 'navigate_to_page']],
  ['Seeing and measuring', ['render_preview', 'measure_text', 'list_page_items', 'get_object_info']],
  ['Text frames and content', ['create_text_frame', 'edit_text_frame', 'list_text_frames', 'get_text_content', 'insert_markdown_text', 'find_replace_text', 'get_selected_objects', 'analyze_embedded_objects']],
  ['Text formatting and typography', ['apply_character_style_to_range', 'clear_overrides', 'fix_typography_in_selection', 'find_typography_issues', 'clean_imported_text', 'analyze_text_problems', 'list_grep_searches', 'list_fonts']],
  ['Styles', ['create_paragraph_style', 'modify_paragraph_style', 'apply_paragraph_style', 'create_character_style', 'modify_character_style', 'create_object_style', 'modify_object_style', 'apply_object_style', 'list_styles']],
  ['Vector shapes and paths', ['create_path', 'create_path_from_svg', 'edit_path_points', 'create_line', 'create_polygon', 'convert_shape', 'set_corner_options', 'pathfinder']],
  ['Fill, stroke and gradients', ['set_object_fill', 'set_object_stroke', 'create_gradient_swatch', 'set_gradient_feather', 'set_object_opacity', 'set_object_overprint']],
  ['Objects and layout', ['create_rectangle', 'create_ellipse', 'set_object_geometry', 'rotate_object', 'delete_object', 'duplicate_object', 'move_to_page', 'send_to_back', 'bring_to_front', 'send_backward', 'bring_forward', 'group_objects', 'ungroup', 'name_object', 'align_objects', 'distribute_objects', 'set_text_frame_options']],
  ['Images and graphics', ['place_image', 'place_image_in_shape', 'place_graphic', 'create_graphic_from_svg', 'create_cmyk_pdf_shape']],
  ['Colour', ['create_color_swatch', 'update_color_swatch', 'delete_color_swatch', 'list_color_swatches', 'apply_color', 'convert_rgb_to_cmyk']],
  ['Tables', ['create_table', 'populate_table']],
  ['Layout setup: format, margins, grids, guides', ['get_layout_setup', 'set_document_setup', 'set_margins_columns', 'create_grid_guides', 'add_guides', 'delete_guides', 'set_grids']],
  ['Aligning on the grid', ['get_page_grid', 'snap_to_grid', 'fit_to_grid']],
  ['French typography', ['french_typography']],
  ['Page numbers, sections, spreads',['insert_special_character', 'set_section', 'set_spread_options', 'view_page_map']],
  ['Masters (parent pages)', ['find_repeated_items', 'create_master', 'copy_to_master', 'apply_master', 'list_master_items', 'override_master_items', 'remove_master_overrides', 'set_master', 'delete_master']],
  ['Alternate layouts', ['create_alternate_layout', 'delete_alternate_layout', 'compare_layouts']],
  ['Layers', ['create_layer', 'set_active_layer', 'list_layers', 'move_layer', 'move_to_layer', 'set_layer', 'delete_layer']],
  ['Export and production', ['export_pdf', 'export_images', 'export_epub', 'package_document', 'preflight_document', 'data_merge']],
  ['Utilities', ['run_script', 'execute_indesign_code', 'add_improvement_note', 'read_improvement_notes']],
];

const client = new Client({ name: 'docs', version: '1' }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(root, 'index.js')] }));
const { tools } = await client.listTools();
await client.close();

const byName = new Map(tools.map((t) => [t.name, t]));
const listed = new Set(CATEGORIES.flatMap(([, names]) => names));
const other = tools.map((t) => t.name).filter((n) => !listed.has(n));
if (other.length) CATEGORIES.push(['Other', other]);

const esc = (s = '') => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
let md = `_${tools.length} tools. Generated from the server's tool schemas by \`npm run docs\`._\n`;
for (const [title, names] of CATEGORIES) {
  const present = names.filter((n) => byName.has(n));
  if (!present.length) continue;
  md += `\n### ${title}\n`;
  for (const name of present) {
    const t = byName.get(name);
    const props = t.inputSchema?.properties || {};
    const required = new Set(t.inputSchema?.required || []);
    md += `\n#### \`${name}\`\n\n${esc(t.description)}\n`;
    const keys = Object.keys(props);
    if (!keys.length) { md += '\n_No parameters._\n'; continue; }
    md += '\n| Parameter | Type | Description |\n|---|---|---|\n';
    for (const k of keys) {
      const p = props[k];
      let type = p.type === 'array' ? `${p.items?.type || 'any'}[]` : p.type || 'any';
      if (p.enum) type = p.enum.map((v) => `\`${v}\``).join(' \\| ');
      const def = p.default !== undefined ? ` Default: \`${JSON.stringify(p.default)}\`.` : '';
      md += `| \`${k}\`${required.has(k) ? ' *(required)*' : ''} | ${type} | ${esc(p.description)}${def} |\n`;
    }
  }
}

const docPath = path.join(root, 'docs', 'TOOLS.md');
const doc = fs.readFileSync(docPath, 'utf8');
const start = '<!-- TOOLS:START -->';
const end = '<!-- TOOLS:END -->';
if (!doc.includes(start) || !doc.includes(end)) throw new Error('docs/TOOLS.md is missing the TOOLS markers');
fs.writeFileSync(docPath, doc.slice(0, doc.indexOf(start) + start.length) + '\n' + md + '\n' + doc.slice(doc.indexOf(end)));
console.log(`docs/TOOLS.md updated with ${tools.length} tools`);
