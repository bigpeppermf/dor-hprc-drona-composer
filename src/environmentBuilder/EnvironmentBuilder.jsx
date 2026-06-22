import React, { useEffect, useRef, useState, useCallback } from "react";
import * as Blockly from "blockly";
import {
  defineBlocks,
  toolbox,
  buildSchema,
  buildRegistry,
  buildMap,
  buildTemplate,
  buildDriver,
  setRegistryForDropdowns,
  setMapKeysForDropdowns,
} from "./blocks";
import PropertyPanel from "./PropertyPanel";
import SaveBar from "./SaveBar";
import Composer from "../schemaRendering/Composer";
import { validateAll, countByLevel } from "./validate";
import { makeBlocklyTheme } from "./blocklyTheme";
import { collectDropdownSeeds } from "./importEnv";
import { T, card, panelHeader, codeBlock, input, cssVar, hint as hintStyle } from "./theme";

/**
 * Milestone 2: build a schema visually with blocks, edit scalar props in the
 * side panel, and see it rendered live through the real Composer.
 */
export default function EnvironmentBuilder() {
  const blocklyDivRef = useRef(null);
  const workspaceRef = useRef(null);

  const [schema, setSchema] = useState({});
  const [registry, setRegistry] = useState([]);
  const [map, setMap] = useState({});
  const [template, setTemplate] = useState("");
  const [driver, setDriver] = useState("");
  const [utils, setUtils] = useState(""); // hand-authored utils.py for !func()
  const [selectedId, setSelectedId] = useState(null);
  const [tick, setTick] = useState(0); // bumps on any workspace change
  // "form" | "json" | "map" | "template" | "driver" | "utils" | "issues"
  const [view, setView] = useState("form");

  const rebuild = useCallback(() => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const reg = buildRegistry(ws);
    const m = buildMap(ws);
    setRegistryForDropdowns(reg); // keep map_field dropdowns in sync
    setMapKeysForDropdowns(Object.keys(m)); // keep [KEY] dropdowns in sync
    setSchema(buildSchema(ws));
    setRegistry(reg);
    setMap(m);
    setTemplate(buildTemplate(ws));
    setDriver(buildDriver(ws));
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    defineBlocks();

    const workspace = Blockly.inject(blocklyDivRef.current, {
      toolbox,
      renderer: "thrasos", // thin, flat blocks (less "default Blockly")
      theme: makeBlocklyTheme(),
      trashcan: true,
      move: { scrollbars: true, drag: true, wheel: true },
      zoom: { controls: true, wheel: false, startScale: 0.95 },
      grid: {
        spacing: 22,
        length: 3,
        colour: cssVar("--canvas-grid", "#e6e6e6"),
        snap: true,
      },
    });
    workspaceRef.current = workspace;

    workspace.addChangeListener((event) => {
      if (event.type === Blockly.Events.SELECTED) {
        setSelectedId(event.newElementId || null);
        return;
      }
      if (event.isUiEvent) return;
      rebuild();
    });
    rebuild();

    // Keep the Blockly SVG sized to its (now flexible) container.
    const onResize = () => Blockly.svgResize(workspace);
    window.addEventListener("resize", onResize);
    Blockly.svgResize(workspace);

    // Follow the site theme switcher: restyle blocks + canvas on change.
    const onTheme = () => {
      workspace.setTheme(makeBlocklyTheme());
      Blockly.svgResize(workspace);
    };
    window.addEventListener("drona-theme-change", onTheme);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("drona-theme-change", onTheme);
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, [rebuild]);

  const selectedBlock =
    selectedId && workspaceRef.current
      ? workspaceRef.current.getBlockById(selectedId)
      : null;

  const getBuilder = () =>
    workspaceRef.current
      ? Blockly.serialization.workspaces.save(workspaceRef.current)
      : null;

  // Reopen a saved environment: load its Blockly state back onto the canvas.
  const onLoad = (builder) => {
    const ws = workspaceRef.current;
    if (!ws || !builder) return;
    // Seed the dynamic dropdowns from the incoming blocks first, so map_field
    // ($field) and [KEY] selections aren't dropped during deserialization.
    const { fieldNames, mapKeys } = collectDropdownSeeds(builder);
    setRegistryForDropdowns(fieldNames.map((n) => ({ name: n })));
    setMapKeysForDropdowns(mapKeys);
    ws.clear();
    Blockly.serialization.workspaces.load(builder, ws);
    rebuild();
  };

  const issues = validateAll({ schema, map, template, driver, registry });
  const counts = countByLevel(issues);

  const tabs = [
    ["form", "Form"],
    ["json", "schema.json"],
    ["map", "map.json"],
    ["template", "template.txt"],
    ["driver", "driver.sh"],
    ["utils", "utils.py"],
    ["issues", "Checks"],
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        gap: "0.85rem",
        background: T.surfaceMuted,
      }}
    >
      <div style={{ display: "flex", gap: "0.85rem", flex: "1 1 auto", minHeight: 0 }}>
        {/* Block canvas */}
        <div
          ref={blocklyDivRef}
          style={{ ...card, flex: "1 1 auto", minWidth: 0, padding: 0 }}
        />

        {/* Property panel */}
        <PropertyPanel
          key={selectedBlock ? selectedBlock.id : "none"}
          block={selectedBlock}
          tick={tick}
          registry={registry}
          onChange={rebuild}
        />

        {/* Live preview */}
        <div style={{ ...card, flex: "0 0 430px" }}>
          <div style={panelHeader}>
            <span>Live preview</span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 2,
              padding: "0.4rem 0.5rem 0",
              background: T.surfaceMuted,
              borderBottom: `1px solid ${T.line}`,
              flexWrap: "wrap",
              flex: "0 0 auto",
            }}
          >
            {tabs.map(([id, label]) => (
              <TabButton key={id} active={view === id} onClick={() => setView(id)}>
                {label}
                {id === "issues" && counts.error + counts.warn > 0 && (
                  <Badge error={counts.error > 0}>{counts.error + counts.warn}</Badge>
                )}
              </TabButton>
            ))}
          </div>

          <div style={{ flex: "1 1 auto", overflow: "auto", padding: "0.85rem" }}>
            {renderPreview({ view, schema, map, template, driver, utils, setUtils, issues })}
          </div>
        </div>
      </div>

      <SaveBar
        schema={schema}
        map={map}
        template={template}
        driver={driver}
        utils={utils}
        getBuilder={getBuilder}
        onLoad={onLoad}
        errorCount={counts.error}
      />
    </div>
  );
}

const preStyle = codeBlock;

/** Pick what the live-preview pane shows for the active tab. */
function renderPreview({ view, schema, map, template, driver, utils, setUtils, issues }) {
  if (view === "utils") {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 6 }}>
        <div style={hintStyle}>
          Python backing your <code>!func()</code> map calls. Saved as{" "}
          <code>utils.py</code>.
        </div>
        <textarea
          value={utils}
          onChange={(e) => setUtils(e.target.value)}
          spellCheck={false}
          placeholder={"def my_func(x):\n    return x.upper()"}
          style={{
            ...input,
            flex: "1 1 auto",
            minHeight: 220,
            fontFamily: T.mono,
            fontSize: "0.8rem",
            lineHeight: 1.5,
            resize: "none",
          }}
        />
      </div>
    );
  }

  if (view === "issues") {
    if (issues.length === 0) {
      return <div style={{ ...hintStyle, color: T.ok }}>✓ No problems found.</div>;
    }
    return (
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {issues.map((it, i) => (
          <li
            key={i}
            style={{
              display: "flex",
              gap: 8,
              padding: "0.4rem 0.2rem",
              borderBottom: `1px solid ${T.line}`,
              fontSize: "0.82rem",
              color: T.ink,
            }}
          >
            <span style={{ color: it.level === "error" ? T.err : "#b8860b", fontWeight: 700 }}>
              {it.level === "error" ? "●" : "▲"}
            </span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (view === "map") {
    return Object.keys(map).length === 0 ? (
      <div style={hintStyle}>
        Add <strong>map</strong> blocks to define how form values fill your
        template ([KEY] placeholders).
      </div>
    ) : (
      <pre style={preStyle}>{JSON.stringify(map, null, 2)}</pre>
    );
  }

  if (view === "template") {
    return template ? (
      <pre style={preStyle}>{template}</pre>
    ) : (
      <div style={hintStyle}>
        Add <strong>template</strong> blocks to build the job script
        (template.txt).
      </div>
    );
  }

  if (view === "driver") {
    return driver ? (
      <pre style={preStyle}>{driver}</pre>
    ) : (
      <div style={hintStyle}>
        Add <strong>driver</strong> blocks (the standard sbatch driver covers
        most cases).
      </div>
    );
  }

  // Schema-backed views (Form / schema.json).
  if (Object.keys(schema).length === 0) {
    return <div style={hintStyle}>Drag blocks onto the canvas to build your form.</div>;
  }
  return view === "form" ? (
    <Composer fields={schema} environment={{}} setError={() => {}} />
  ) : (
    <pre style={preStyle}>{JSON.stringify(schema, null, 2)}</pre>
  );
}

function Badge({ error, children }) {
  return (
    <span
      style={{
        marginLeft: 5,
        padding: "0 5px",
        borderRadius: 8,
        fontSize: "0.65rem",
        fontWeight: 700,
        color: "#fff",
        background: error ? T.err : "#b8860b",
      }}
    >
      {children}
    </span>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        borderBottom: active ? `2px solid ${T.maroon}` : "2px solid transparent",
        borderRadius: "5px 5px 0 0",
        padding: "5px 10px",
        fontSize: "0.74rem",
        cursor: "pointer",
        background: active ? T.surface : "transparent",
        color: active ? T.maroon : T.sub,
        fontWeight: active ? 700 : 500,
        fontFamily: /\./.test(String(children)) ? T.mono : "inherit",
      }}
    >
      {children}
    </button>
  );
}
