/**
 * Cross-layer integrity checks for a block-built environment. These mirror the
 * places the engine will silently fail: a $field that names no schema field, a
 * [KEY] with no map entry, a condition referencing an unknown field, etc.
 *
 * Returns a flat list of { level: "error" | "warn", text } — errors are things
 * that will definitely break a submit; warnings are likely-mistakes.
 */
import { extractFieldRefs } from "./conditionUtils";

const FIELD_REF_RE = /\$(\w+)/g; // $field inside a map value
const KEY_REF_RE = /\[([\w-]+)\]/g; // [KEY] inside template text

// [KEY]s the engine fills in itself / the stage step injects — never "missing".
const BUILTIN_KEYS = new Set(["job-file-name", "flocation"]);

function refsIn(text, re) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** Walk the (nested) schema collecting every field/container condition. */
function collectConditions(schema, acc = []) {
  Object.values(schema || {}).forEach((node) => {
    if (node && typeof node === "object") {
      if (node.condition) acc.push({ name: node.name, condition: node.condition });
      if (node.elements) collectConditions(node.elements, acc);
    }
  });
  return acc;
}

export function validateAll({ schema, map, template, driver, registry }) {
  const issues = [];
  const add = (level, text) => issues.push({ level, text });

  const fieldNames = new Set((registry || []).map((f) => f.name));
  const mapKeys = new Set(Object.keys(map || {}));

  // Duplicate field names — schema is keyed by name, so dupes silently collapse.
  const seen = new Set();
  (registry || []).forEach((f) => {
    if (seen.has(f.name)) add("error", `Duplicate field name "${f.name}".`);
    seen.add(f.name);
  });

  // Conditions referencing unknown fields.
  collectConditions(schema).forEach(({ name, condition }) => {
    extractFieldRefs(condition)
      .filter((r) => !fieldNames.has(r))
      .forEach((r) =>
        add("warn", `Condition on "${name}" references unknown field "${r}".`)
      );
  });

  // map values: $field must name a real schema field.
  Object.entries(map || {}).forEach(([key, value]) => {
    refsIn(String(value), FIELD_REF_RE)
      .filter((r) => !fieldNames.has(r))
      .forEach((r) =>
        add("warn", `Map "${key}" uses $${r}, but no field "${r}" exists.`)
      );
  });

  // template/driver [KEY] must have a map entry (or be a builtin).
  [["template.txt", template], ["driver.sh", driver]].forEach(([file, text]) => {
    refsIn(String(text || ""), KEY_REF_RE)
      .filter((k) => !BUILTIN_KEYS.has(k) && !mapKeys.has(k))
      .forEach((k) => add("error", `${file} references [${k}] with no map entry.`));
  });

  // Gentle nudges for an obviously-incomplete environment.
  if (Object.keys(schema || {}).length === 0)
    add("warn", "No schema fields yet — the form will be empty.");
  if (!String(driver || "").trim())
    add("warn", "No driver blocks — add the standard sbatch driver.");

  return issues;
}

export function countByLevel(issues) {
  return issues.reduce(
    (acc, i) => ({ ...acc, [i.level]: (acc[i.level] || 0) + 1 }),
    { error: 0, warn: 0 }
  );
}
