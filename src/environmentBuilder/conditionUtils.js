/**
 * Helpers for the registry-backed condition editor. The tokenizer mirrors
 * src/schemaRendering/utils/conditionEvaluator.js so validation matches how the
 * condition is actually evaluated at runtime.
 */

const TOKEN_RE = /(\|\||&&|\(|\)|!|\^|[^\s\|\&\(\)]+)/g;
const OPERATORS = new Set(["||", "&&", "(", ")", "!", "^"]);

export function tokenize(condition) {
  if (!condition) return [];
  return condition.match(TOKEN_RE) || [];
}

/** Field names referenced by a condition (the part before the first "."). */
export function extractFieldRefs(condition) {
  return tokenize(condition)
    .filter((t) => !OPERATORS.has(t))
    .map((t) => t.split(".")[0])
    .filter(Boolean);
}

/** Returns { valid, unknown:[names] } against a registry ([{name},...]). */
export function validateCondition(condition, registry) {
  const known = new Set(registry.map((f) => f.name));
  const unknown = [...new Set(extractFieldRefs(condition))].filter(
    (n) => !known.has(n)
  );
  return { valid: unknown.length === 0, unknown };
}

/** True when the condition is a single `field.value` atom (no operators). */
export function isSimpleAtom(condition) {
  const tokens = tokenize(condition);
  const hasOps = tokens.some((t) => OPERATORS.has(t));
  const atoms = tokens.filter((t) => !OPERATORS.has(t));
  return !hasOps && atoms.length === 1 && atoms[0].includes(".");
}

export function splitAtom(condition) {
  const idx = (condition || "").indexOf(".");
  if (idx === -1) return { field: condition || "", value: "" };
  return { field: condition.slice(0, idx), value: condition.slice(idx + 1) };
}
