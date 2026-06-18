import React, { useState, useEffect } from "react";
import {
  isSimpleAtom,
  splitAtom,
  validateCondition,
} from "./conditionUtils";
import { T, card, panelHeader, input as inputStyle } from "./theme";

/**
 * Edits the scalar props of the selected block. Structural props (type, name,
 * nesting) stay on the block itself; this panel handles label / help / condition
 * / options and stashes them on `block.builderProps`.
 *
 * `registry` is the list of declared fields (see buildRegistry) used to drive
 * the condition picker so cross-references can't be mistyped.
 */
export default function PropertyPanel({ block, tick, registry = [], onChange }) {
  const [props, setProps] = useState(() => ({ ...(block?.builderProps || {}) }));

  useEffect(() => {
    setProps({ ...(block?.builderProps || {}) });
  }, [block]);

  if (!block) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>Properties</div>
        <div style={{ padding: "1rem", color: "#666", fontSize: "0.85rem" }}>
          Select a block to edit its properties.
        </div>
      </div>
    );
  }

  const isField = block.type === "schema_field";
  const fieldType = isField ? block.getFieldValue("TYPE") : null;
  const name = block.getFieldValue("NAME");

  const update = (key, val) => {
    const next = { ...props, [key]: val };
    setProps(next);
    block.builderProps = next;
    onChange();
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Properties</div>
      <div style={{ padding: "0.75rem", overflowY: "auto" }}>
        <div style={metaStyle}>
          <strong>{block.type === "schema_container" ? "Container" : "Field"}</strong>
          {" · "}
          <code>{name}</code>
          {fieldType ? <span> · {fieldType}</span> : null}
        </div>

        <Labeled label="Label">
          <input
            style={inputStyle}
            value={props.label || ""}
            placeholder={name}
            onChange={(e) => update("label", e.target.value)}
          />
        </Labeled>

        {isField && (
          <Labeled label="Help text">
            <input
              style={inputStyle}
              value={props.help || ""}
              onChange={(e) => update("help", e.target.value)}
            />
          </Labeled>
        )}

        {isField && fieldType === "select" && (
          <Labeled label="Options (one per line: value|Label)">
            <textarea
              style={{ ...inputStyle, height: 110, fontFamily: "monospace" }}
              value={props.options || ""}
              placeholder={"gpu|GPU\ncpu|CPU"}
              onChange={(e) => update("options", e.target.value)}
            />
          </Labeled>
        )}

        <Labeled label="Show this field when">
          <ConditionEditor
            condition={props.condition || ""}
            registry={registry}
            selfName={name}
            onChange={(c) => update("condition", c)}
          />
        </Labeled>
      </div>
    </div>
  );
}

/** Registry-backed condition picker, with an advanced free-text mode. */
function ConditionEditor({ condition, registry, selfName, onChange }) {
  const simple = isSimpleAtom(condition);
  const canSimple = !condition || simple;
  const [advanced, setAdvanced] = useState(!canSimple);

  const showAdvanced = advanced || !canSimple;
  const choices = registry.filter((f) => f.name && f.name !== selfName);

  if (showAdvanced) {
    const { unknown } = validateCondition(condition, registry);
    return (
      <div>
        <input
          style={inputStyle}
          value={condition}
          placeholder="e.g. useGPU.true && partition.gpu"
          onChange={(e) => onChange(e.target.value)}
        />
        {unknown.length > 0 && (
          <div style={warnStyle}>
            Unknown field{unknown.length > 1 ? "s" : ""}: {unknown.join(", ")}
          </div>
        )}
        <button
          type="button"
          style={linkBtnStyle}
          disabled={!canSimple}
          title={canSimple ? "" : "Compound expression — edit here"}
          onClick={() => setAdvanced(false)}
        >
          ‹ Simple
        </button>
      </div>
    );
  }

  const atom = splitAtom(condition);
  const selField = registry.find((f) => f.name === atom.field);

  const onField = (f) => {
    if (!f) return onChange("");
    const fld = registry.find((x) => x.name === f);
    onChange(`${f}.${defaultValueFor(fld)}`);
  };

  return (
    <div>
      <select style={inputStyle} value={atom.field} onChange={(e) => onField(e.target.value)}>
        <option value="">— always shown —</option>
        {choices.map((f) => (
          <option key={f.name} value={f.name}>
            {f.name}
          </option>
        ))}
      </select>

      {atom.field && (
        <div style={{ marginTop: 6 }}>
          <ValueControl
            field={selField}
            value={atom.value}
            onChange={(v) => onChange(`${atom.field}.${v}`)}
          />
        </div>
      )}

      <button type="button" style={linkBtnStyle} onClick={() => setAdvanced(true)}>
        Advanced (and / or) ›
      </button>
    </div>
  );
}

function ValueControl({ field, value, onChange }) {
  if (field && field.type === "select" && field.options.length > 0) {
    return (
      <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— equals —</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (field && field.type === "checkbox") {
    return (
      <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  return (
    <input
      style={inputStyle}
      value={value}
      placeholder="equals…"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function defaultValueFor(field) {
  if (!field) return "";
  if (field.type === "select" && field.options.length > 0) return field.options[0].value;
  if (field.type === "checkbox") return "true";
  return "";
}

function Labeled({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: "0.75rem" }}>
      <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, marginBottom: 4, color: "#444" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const panelStyle = { ...card, flex: "0 0 290px" };

const headerStyle = panelHeader;

const metaStyle = {
  fontSize: "0.8rem",
  color: T.sub,
  marginBottom: "0.85rem",
  paddingBottom: "0.6rem",
  borderBottom: `1px solid ${T.line}`,
};

const warnStyle = {
  marginTop: 4,
  color: T.err,
  fontSize: "0.75rem",
};

const linkBtnStyle = {
  marginTop: 6,
  background: "none",
  border: "none",
  color: T.maroon,
  fontSize: "0.75rem",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
};
