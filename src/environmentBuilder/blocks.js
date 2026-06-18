import * as Blockly from "blockly";

/**
 * Environment Builder — schema block set (milestone 2).
 *
 * Two block kinds:
 *   - schema_field      a single form field (type dropdown + name)
 *   - schema_container  a group that nests fields/containers (elements)
 *
 * Structural props (type, name, nesting) live on the blocks. Scalar props
 * (label, help, condition, options) live on the property side-panel and are
 * stashed on `block.builderProps`. We build the schema by walking the block
 * tree (see buildSchema) rather than Blockly's linear text generator, because
 * a schema is a nested object, not a flat script.
 */

// Field types exposed in milestone 2 (the "flat" scalar types from componentsMap).
export const FIELD_TYPES = [
  ["text", "text"],
  ["number", "number"],
  ["select", "select"],
  ["checkbox", "checkbox"],
  ["textarea", "textarea"],
  ["time", "time"],
];

const CONTAINER_TYPES = [
  ["container", "container"],
  ["row", "rowContainer"],
];

// --- Dynamic field dropdown (map_field) ---------------------------------
// Blockly dropdowns need their options at open-time. We keep a module-level
// list of declared field names, refreshed from the registry on every workspace
// change (see setRegistryForDropdowns), and the map_field dropdown reads it.
let registryNames = [];

export function setRegistryForDropdowns(registry) {
  registryNames = registry.map((f) => f.name).filter(Boolean);
}

function fieldDropdownOptions() {
  if (registryNames.length === 0) return [["(define a field first)", ""]];
  return registryNames.map((n) => [n, n]);
}

// --- Dynamic [KEY] dropdown (template/driver) ---------------------------
// Same idea as the field dropdown, but for map.json keys: the template's
// [KEY] references can only point at keys you've actually mapped.
let mapKeys = [];

export function setMapKeysForDropdowns(keys) {
  mapKeys = keys.filter(Boolean);
}

function mapKeyDropdownOptions() {
  if (mapKeys.length === 0) return [["(add a map entry)", ""]];
  return mapKeys.map((k) => [k, k]);
}

let blocksDefined = false;

export function defineBlocks() {
  if (blocksDefined) return;
  blocksDefined = true;

  Blockly.defineBlocksWithJsonArray([
    {
      type: "schema_field",
      message0: "field %1 name %2",
      args0: [
        { type: "field_dropdown", name: "TYPE", options: FIELD_TYPES },
        { type: "field_input", name: "NAME", text: "field1" },
      ],
      previousStatement: null,
      nextStatement: null,
      style: "field_block",
      tooltip: "A form field. Edit its label/help/options in the panel.",
    },
    {
      type: "schema_container",
      message0: "%1 group  name %2",
      args0: [
        { type: "field_dropdown", name: "CTYPE", options: CONTAINER_TYPES },
        { type: "field_input", name: "NAME", text: "group1" },
      ],
      message1: "%1",
      args1: [{ type: "input_statement", name: "ELEMENTS" }],
      previousStatement: null,
      nextStatement: null,
      style: "container_block",
      tooltip: "Groups fields together (container / row).",
    },
    // --- Map blocks (milestone 4) ---
    {
      // KEY = <value parts>. KEY is the [KEY] placeholder used in template/driver.
      type: "map_entry",
      message0: "map [ %1 ]  =",
      args0: [{ type: "field_input", name: "KEY", text: "KEY" }],
      message1: "%1",
      args1: [{ type: "input_statement", name: "PARTS", check: "map_part" }],
      previousStatement: "map_entry",
      nextStatement: "map_entry",
      style: "map_block",
      tooltip:
        "One map.json entry. The value is built from the parts stacked inside.",
    },
    {
      // Literal text part.
      type: "map_text",
      message0: "text %1",
      args0: [{ type: "field_input", name: "TEXT", text: "--flag" }],
      previousStatement: "map_part",
      nextStatement: "map_part",
      style: "mappart_block",
      tooltip: "Literal text inserted as-is.",
    },
    {
      // !func(args) part.
      type: "map_func",
      message0: "call ! %1 ( %2 )",
      args0: [
        { type: "field_input", name: "FUNC", text: "my_func" },
        { type: "field_input", name: "ARGS", text: "" },
      ],
      previousStatement: "map_part",
      nextStatement: "map_part",
      style: "mappart_block",
      tooltip:
        "Calls a utils.py function: !func(args). Args may contain $field refs.",
    },
    // --- Template blocks (milestone 5) → template.txt lines ---
    {
      type: "tmpl_shebang",
      message0: "#!/bin/bash",
      previousStatement: "tmpl_line",
      nextStatement: "tmpl_line",
      style: "template_block",
      tooltip: "Script header line.",
    },
    {
      type: "tmpl_comment",
      message0: "# %1",
      args0: [{ type: "field_input", name: "TEXT", text: "comment" }],
      previousStatement: "tmpl_line",
      nextStatement: "tmpl_line",
      style: "template_block",
      tooltip: "A comment line.",
    },
    {
      type: "tmpl_module",
      message0: "module load %1",
      args0: [{ type: "field_input", name: "TEXT", text: "GCC" }],
      previousStatement: "tmpl_line",
      nextStatement: "tmpl_line",
      style: "template_block",
      tooltip: "module load <modules>.",
    },
    {
      type: "tmpl_line",
      message0: "line %1",
      args0: [{ type: "field_input", name: "TEXT", text: "" }],
      previousStatement: "tmpl_line",
      nextStatement: "tmpl_line",
      style: "template_block",
      tooltip: "A raw script line. May contain [KEY] references typed inline.",
    },
    // --- Driver blocks (milestone 5) → driver.sh lines ---
    {
      type: "driver_line",
      message0: "line %1",
      args0: [{ type: "field_input", name: "TEXT", text: "" }],
      previousStatement: "driver_line",
      nextStatement: "driver_line",
      style: "driver_block",
      tooltip: "A raw driver.sh line (for custom submission logic).",
    },
  ]);

  // Standard sbatch driver — emits the common boilerplate as one block.
  Blockly.Blocks["driver_standard"] = {
    init() {
      this.appendDummyInput().appendField("standard sbatch driver");
      this.setPreviousStatement(true, "driver_line");
      this.setNextStatement(true, "driver_line");
      this.setStyle("driver_block");
      this.setTooltip(
        "cd [flocation] + drona_wf_driver_sbatch [job-file-name]."
      );
    },
  };

  // #SBATCH directive whose value is a [KEY] from the map (dynamic dropdown).
  Blockly.Blocks["tmpl_sbatch"] = {
    init() {
      this.appendDummyInput()
        .appendField("#SBATCH --")
        .appendField(new Blockly.FieldTextInput("time"), "FLAG")
        .appendField("= [")
        .appendField(new Blockly.FieldDropdown(mapKeyDropdownOptions), "KEY")
        .appendField("]");
      this.setPreviousStatement(true, "tmpl_line");
      this.setNextStatement(true, "tmpl_line");
      this.setStyle("template_block");
      this.setTooltip("#SBATCH directive; value is a [KEY] from your map.");
    },
  };

  // A line that inserts a single [KEY] expansion (e.g. [modules], [commands]).
  Blockly.Blocks["tmpl_keyline"] = {
    init() {
      this.appendDummyInput()
        .appendField("insert [")
        .appendField(new Blockly.FieldDropdown(mapKeyDropdownOptions), "KEY")
        .appendField("]");
      this.setPreviousStatement(true, "tmpl_line");
      this.setNextStatement(true, "tmpl_line");
      this.setStyle("template_block");
      this.setTooltip("Expands a [KEY] from the map on its own line.");
    },
  };

  // map_field needs a *dynamic* dropdown (registry-driven), which the JSON
  // array form can't express, so define it imperatively.
  Blockly.Blocks["map_field"] = {
    init() {
      this.appendDummyInput()
        .appendField("field")
        .appendField(new Blockly.FieldTextInput(""), "PREFIX")
        .appendField("$")
        .appendField(new Blockly.FieldDropdown(fieldDropdownOptions), "FIELD");
      this.setPreviousStatement(true, "map_part");
      this.setNextStatement(true, "map_part");
      this.setStyle("mappart_block");
      this.setTooltip(
        "References a form field's value: $field. Optional prefix like '-N ' or '--mem='."
      );
    },
  };
}

export const toolbox = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Fields",
      colour: "230",
      contents: [{ kind: "block", type: "schema_field" }],
    },
    {
      kind: "category",
      name: "Containers",
      colour: "120",
      contents: [{ kind: "block", type: "schema_container" }],
    },
    {
      kind: "category",
      name: "Mapping",
      colour: "60",
      contents: [
        { kind: "block", type: "map_entry" },
        { kind: "block", type: "map_field" },
        { kind: "block", type: "map_text" },
        { kind: "block", type: "map_func" },
      ],
    },
    {
      kind: "category",
      name: "Template",
      colour: "290",
      contents: [
        { kind: "block", type: "tmpl_shebang" },
        { kind: "block", type: "tmpl_sbatch" },
        { kind: "block", type: "tmpl_module" },
        { kind: "block", type: "tmpl_keyline" },
        { kind: "block", type: "tmpl_comment" },
        { kind: "block", type: "tmpl_line" },
      ],
    },
    {
      kind: "category",
      name: "Driver",
      colour: "330",
      contents: [
        { kind: "block", type: "driver_standard" },
        { kind: "block", type: "driver_line" },
      ],
    },
  ],
};

// --- Schema construction -------------------------------------------------

function getProps(block) {
  return block.builderProps || {};
}

/** Parse the options textarea ("value|Label" per line) into [{value,label}]. */
function parseOptions(raw) {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [value, label] = line.split("|").map((s) => s.trim());
      return { value, label: label || value };
    });
}

function blockToEntry(block) {
  const extras = getProps(block);

  if (block.type === "schema_field") {
    const name = block.getFieldValue("NAME");
    const type = block.getFieldValue("TYPE");
    const value = { type, name, label: extras.label || name };
    if (extras.help) value.help = extras.help;
    if (extras.condition) value.condition = extras.condition;
    if (type === "select") value.options = parseOptions(extras.options);
    return { key: name, value };
  }

  if (block.type === "schema_container") {
    const name = block.getFieldValue("NAME");
    const type = block.getFieldValue("CTYPE");
    const first = block.getInputTargetBlock("ELEMENTS");
    const value = {
      type,
      name,
      label: extras.label || name,
      elements: chainToSchema(first),
    };
    if (extras.condition) value.condition = extras.condition;
    return { key: name, value };
  }

  return null;
}

/** Walk a chain of stacked blocks (a block and everything below it). */
function chainToSchema(firstBlock) {
  const result = {};
  let block = firstBlock;
  while (block) {
    const entry = blockToEntry(block);
    if (entry && entry.key) result[entry.key] = entry.value;
    block = block.getNextBlock();
  }
  return result;
}

/** Build the full schema object (keyed by field name) from the workspace. */
export function buildSchema(workspace) {
  const result = {};
  workspace.getTopBlocks(true).forEach((top) => {
    Object.assign(result, chainToSchema(top));
  });
  return result;
}

/**
 * Registry of every declared field, for validated cross-references (conditions
 * now; $field / [KEY] later). Each entry: { name, type, options:[{value,label}] }.
 */
export function buildRegistry(workspace) {
  const fields = [];

  const visit = (block) => {
    while (block) {
      if (block.type === "schema_field") {
        const name = block.getFieldValue("NAME");
        const type = block.getFieldValue("TYPE");
        const extras = getProps(block);
        if (name) {
          fields.push({
            name,
            type,
            options: type === "select" ? parseOptions(extras.options) : [],
          });
        }
      } else if (block.type === "schema_container") {
        const name = block.getFieldValue("NAME");
        if (name) {
          fields.push({ name, type: block.getFieldValue("CTYPE"), options: [] });
        }
        visit(block.getInputTargetBlock("ELEMENTS"));
      }
      block = block.getNextBlock();
    }
  };

  workspace.getTopBlocks(true).forEach(visit);
  return fields;
}

// --- Map construction ----------------------------------------------------

/** One value part → its map.json string fragment. */
function partToString(block) {
  switch (block.type) {
    case "map_text":
      return block.getFieldValue("TEXT") || "";
    case "map_field": {
      const prefix = block.getFieldValue("PREFIX") || "";
      const field = block.getFieldValue("FIELD") || "";
      return field ? `${prefix}$${field}` : prefix;
    }
    case "map_func": {
      const func = block.getFieldValue("FUNC") || "";
      const args = block.getFieldValue("ARGS") || "";
      return `!${func}(${args})`;
    }
    default:
      return "";
  }
}

/** Walk the PARTS chain of a map_entry and space-join the fragments. */
function partsToValue(firstPart) {
  const out = [];
  let block = firstPart;
  while (block) {
    const frag = partToString(block);
    if (frag !== "") out.push(frag);
    block = block.getNextBlock();
  }
  return out.join(" ");
}

/**
 * Build the map.json object ({ KEY: "value string" }) from every map_entry on
 * the workspace. The value string is what the engine substitutes into [KEY]
 * placeholders ($field / !func() / literal, space-joined).
 */
export function buildMap(workspace) {
  const result = {};
  workspace.getTopBlocks(true).forEach((top) => {
    let block = top;
    while (block) {
      if (block.type === "map_entry") {
        const key = block.getFieldValue("KEY");
        if (key) result[key] = partsToValue(block.getInputTargetBlock("PARTS"));
      }
      block = block.getNextBlock();
    }
  });
  return result;
}

/** Convenience for callers needing just the map keys (template [KEY] refs). */
export function mapKeyList(workspace) {
  return Object.keys(buildMap(workspace));
}

// --- Template / driver construction -------------------------------------

const DRIVER_STANDARD = [
  "#!/bin/bash",
  "source /etc/profile",
  "",
  "cd [flocation]",
  "",
  "$DRONA_RUNTIME_DIR/driver_scripts/drona_wf_driver_sbatch [job-file-name]",
].join("\n");

/** One template block → its template.txt line (or null if not a template block). */
function templateLine(block) {
  switch (block.type) {
    case "tmpl_shebang":
      return "#!/bin/bash";
    case "tmpl_comment":
      return `# ${block.getFieldValue("TEXT") || ""}`;
    case "tmpl_module":
      return `module load ${block.getFieldValue("TEXT") || ""}`;
    case "tmpl_line":
      return block.getFieldValue("TEXT") || "";
    case "tmpl_sbatch": {
      const flag = block.getFieldValue("FLAG") || "";
      const key = block.getFieldValue("KEY") || "";
      return key ? `#SBATCH --${flag}=[${key}]` : `#SBATCH --${flag}`;
    }
    case "tmpl_keyline": {
      const key = block.getFieldValue("KEY") || "";
      return key ? `[${key}]` : "";
    }
    default:
      return null;
  }
}

/** One driver block → its driver.sh fragment (or null if not a driver block). */
function driverLine(block) {
  switch (block.type) {
    case "driver_standard":
      return DRIVER_STANDARD;
    case "driver_line":
      return block.getFieldValue("TEXT") || "";
    default:
      return null;
  }
}

/** Walk every block, collecting lines from `lineFor`, preserving block order. */
function buildLines(workspace, lineFor) {
  const lines = [];
  workspace.getTopBlocks(true).forEach((top) => {
    let block = top;
    while (block) {
      const line = lineFor(block);
      if (line !== null) lines.push(line);
      block = block.getNextBlock();
    }
  });
  return lines.join("\n");
}

/** Build template.txt text from the template blocks on the workspace. */
export function buildTemplate(workspace) {
  return buildLines(workspace, templateLine);
}

/** Build driver.sh text from the driver blocks on the workspace. */
export function buildDriver(workspace) {
  return buildLines(workspace, driverLine);
}
