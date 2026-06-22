/**
 * Reverse-import: turn an existing environment's four files into a Blockly
 * workspace-serialization JSON (the shape `Blockly.serialization.workspaces.load`
 * consumes), so a hand-authored env can be opened as editable blocks.
 *
 * These are the inverses of the generators in blocks.js. Where a faithful
 * structured parse isn't guaranteed lossless, we fall back to a raw block so the
 * round-trip still reproduces the original file exactly (the design's priority).
 */
import {
  FIELD_TYPE_SET,
  CONTAINER_TYPE_SET,
  DRIVER_STANDARD,
} from "./blocks";

// Schema keys that have dedicated controls; everything else → extraProps blob.
const DEDICATED = new Set([
  "type", "name", "label", "help", "condition", "options", "retriever", "elements",
]);

// --- shared helpers ------------------------------------------------------

/** Link an array of block objects via `.next`; return the head (or null). */
function chain(blocks) {
  if (!blocks.length) return null;
  for (let i = 0; i < blocks.length - 1; i++) blocks[i].next = { block: blocks[i + 1] };
  return blocks[0];
}

// --- schema.json → blocks ------------------------------------------------

function optionsToText(options) {
  return (options || [])
    .map((o) => (o.label && o.label !== o.value ? `${o.value}|${o.label}` : o.value))
    .join("\n");
}

function propsState(def) {
  const props = {};
  if (def.label && def.label !== def.name) props.label = def.label;
  if (def.help) props.help = def.help;
  if (def.condition) props.condition = def.condition;
  if (def.options) props.options = optionsToText(def.options);
  if (def.retriever) props.retriever = def.retriever;
  const extra = {};
  Object.keys(def).forEach((k) => {
    if (!DEDICATED.has(k)) extra[k] = def[k];
  });
  if (Object.keys(extra).length) props.extraProps = JSON.stringify(extra);
  return Object.keys(props).length ? { props } : null;
}

function fieldBlock(name, def) {
  const type = def && def.type;

  if (CONTAINER_TYPE_SET.has(type)) {
    const block = { type: "schema_container", fields: { CTYPE: type, NAME: name } };
    const state = propsState(def);
    if (state) block.extraState = state;
    const head = chain(schemaBlocks(def.elements || {}));
    if (head) block.inputs = { ELEMENTS: { block: head } };
    return block;
  }

  if (FIELD_TYPE_SET.has(type)) {
    const block = { type: "schema_field", fields: { TYPE: type, NAME: name } };
    const state = propsState(def);
    if (state) block.extraState = state;
    return block;
  }

  // Unknown construct → verbatim raw block (lossless).
  return { type: "schema_raw", fields: { NAME: name, JSON: JSON.stringify(def) } };
}

function schemaBlocks(schemaObj) {
  return Object.entries(schemaObj || {}).map(([name, def]) => fieldBlock(name, def));
}

/**
 * Collect every value stored in a dynamic dropdown across a Blockly
 * serialization, so they can be seeded as valid options *before* load —
 * otherwise deserialization snaps an unknown dropdown value to option 0.
 * $field dropdown ← schema names + map_field FIELDs; [KEY] dropdown ← map keys
 * + every tmpl_sbatch/tmpl_keyline KEY (templates may reference keys not mapped).
 */
export function collectDropdownSeeds(builder) {
  const fieldNames = new Set();
  const mapKeys = new Set();
  const visit = (b) => {
    if (!b) return;
    const f = b.fields || {};
    if (b.type === "schema_field" || b.type === "schema_container" || b.type === "schema_raw") {
      if (f.NAME) fieldNames.add(f.NAME);
    } else if (b.type === "map_field") {
      if (f.FIELD) fieldNames.add(f.FIELD);
    } else if (b.type === "map_entry") {
      if (f.KEY) mapKeys.add(f.KEY);
    } else if (b.type === "tmpl_sbatch" || b.type === "tmpl_keyline") {
      if (f.KEY) mapKeys.add(f.KEY);
    }
    if (b.next && b.next.block) visit(b.next.block);
    if (b.inputs) Object.values(b.inputs).forEach((i) => i && i.block && visit(i.block));
  };
  ((builder.blocks && builder.blocks.blocks) || []).forEach(visit);
  return { fieldNames: [...fieldNames], mapKeys: [...mapKeys] };
}

/** Flatten every field/container name (for seeding the $field dropdowns). */
export function schemaFieldNames(schemaObj) {
  const names = [];
  const walk = (obj) => {
    Object.entries(obj || {}).forEach(([name, def]) => {
      names.push(name);
      if (def && def.elements) walk(def.elements);
    });
  };
  walk(schemaObj);
  return names;
}

// --- map.json → blocks ---------------------------------------------------

function partToStr(p) {
  if (p.type === "map_text") return p.fields.TEXT;
  if (p.type === "map_field") return (p.fields.PREFIX || "") + "$" + p.fields.FIELD;
  if (p.type === "map_func") return "!" + p.fields.FUNC + "(" + p.fields.ARGS + ")";
  return "";
}

function valueToParts(value) {
  return String(value)
    .split(" ")
    .map((tok) => {
      let m;
      if ((m = tok.match(/^!(\w+)\((.*)\)$/)))
        return { type: "map_func", fields: { FUNC: m[1], ARGS: m[2] } };
      if ((m = tok.match(/^(.*)\$(\w+)$/)))
        return { type: "map_field", fields: { PREFIX: m[1], FIELD: m[2] } };
      return { type: "map_text", fields: { TEXT: tok } };
    });
}

function mapEntryBlock(key, value) {
  const parts = valueToParts(value);
  // buildMap space-joins NON-EMPTY fragments; only use structured parts if that
  // reproduces the original exactly, else fall back to one raw text part.
  const rejoined = parts.map(partToStr).filter((s) => s !== "").join(" ");
  const partBlocks =
    rejoined === String(value)
      ? parts
      : [{ type: "map_text", fields: { TEXT: String(value) } }];
  const block = { type: "map_entry", fields: { KEY: key } };
  const head = chain(partBlocks);
  if (head) block.inputs = { PARTS: { block: head } };
  return block;
}

// --- template.txt / driver.sh → blocks -----------------------------------

function templateBlocks(text) {
  return String(text)
    .split("\n")
    .map((line) => {
      if (line === "#!/bin/bash") return { type: "tmpl_shebang" };
      let m;
      if ((m = line.match(/^#SBATCH --(\S+?)=\[([\w-]+)\]$/)))
        return { type: "tmpl_sbatch", fields: { FLAG: m[1], KEY: m[2] } };
      if ((m = line.match(/^\[([\w-]+)\]$/)))
        return { type: "tmpl_keyline", fields: { KEY: m[1] } };
      if ((m = line.match(/^module load (.*)$/)))
        return { type: "tmpl_module", fields: { TEXT: m[1] } };
      if ((m = line.match(/^# (.*)$/)))
        return { type: "tmpl_comment", fields: { TEXT: m[1] } };
      return { type: "tmpl_line", fields: { TEXT: line } };
    });
}

function driverBlocks(text) {
  const t = String(text);
  if (t === DRIVER_STANDARD) return [{ type: "driver_standard" }];
  return t.split("\n").map((line) => ({ type: "driver_line", fields: { TEXT: line } }));
}

// --- assemble ------------------------------------------------------------

/**
 * { schema, map, template, driver } → Blockly workspace JSON. Each file becomes
 * its own top-level stack, laid out left-to-right so they don't overlap.
 */
export function importEnv({ schema, map, template, driver } = {}) {
  const tops = [];
  const place = (head, x) => {
    if (head) {
      head.x = x;
      head.y = 20;
      tops.push(head);
    }
  };

  place(chain(schemaBlocks(schema || {})), 20);
  place(
    chain(Object.entries(map || {}).map(([k, v]) => mapEntryBlock(k, v))),
    360
  );
  if (template && String(template).trim())
    place(chain(templateBlocks(template)), 700);
  if (driver && String(driver).trim())
    place(chain(driverBlocks(driver)), 1040);

  return { blocks: { languageVersion: 0, blocks: tops } };
}
