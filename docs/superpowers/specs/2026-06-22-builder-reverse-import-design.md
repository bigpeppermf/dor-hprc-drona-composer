# Design: Load existing environments into the Builder as editable blocks

Status: **Approved (brainstorming)** · Date: 2026-06-22

Builds on the completed Environment Builder (`src/environmentBuilder/`, see
`docs/design/environment-builder.md`). Goal: open an *existing* Drona
environment in the builder and edit it as blocks — **"convert & edit"**: the
round-trip must reproduce working files, because the user re-Stages/Promotes.

## Phasing

- **Phase A — Expand the schema palette** (this spec's focus; prerequisite).
- **Phase B — Reverse-import** parser/route (sketched here; own spec later).

Reverse-import is only safe once the palette can *represent* every construct an
env contains; hence Phase A first. The map/template/driver layers already have
raw-line blocks (`map_text`/`tmpl_line`/`driver_line`) and import losslessly —
schema is the gap.

## Current coverage vs. target

Source of truth: `src/schemaRendering/schemaElements/index.js`
(`componentsMap` = 25 field types, `Containers` = 6).

- **Have:** fields text/number/select/checkbox/textarea/time; containers
  container/rowContainer.
- **Add (fields):** radioGroup, checkboxGroup, autocompleteSelect, dynamicSelect,
  dynamicRadioGroup, dynamicCheckboxGroup, dynamicViewer, module, unit,
  staticText, hidden, picker, uploader, jobNameLocation (treated as a leaf).
- **Add (containers):** collapsibleRowContainer, collapsibleColContainer,
  dragDropContainer.

## Phase A design (mostly additive — no new block shapes)

The M2 "generic field block" decision means most new types are just dropdown
entries, not new blocks.

1. **Field block** — extend the `schema_field` TYPE dropdown with the missing
   field types. `jobNameLocation` is a leaf (no nested elements).
2. **Container block** — extend the `schema_container` CTYPE dropdown with the
   3 missing container types.
3. **Property panel** — conditional by type:
   - **Options** (value|Label) for static option-lists: select, radioGroup,
     checkboxGroup, autocompleteSelect.
   - **Retriever** (new text field) for retriever-backed types: dynamicSelect,
     dynamicRadioGroup, dynamicCheckboxGroup, dynamicViewer, autocompleteSelect.
     A retriever is just a script-name string; no dropdown needed.
   - **Advanced → extra props (JSON)** textarea on every block.
4. **Lossless safety net.** `buildSchema` spreads the parsed extra-props JSON
   into the emitted field object *first*, then sets the dedicated keys
   (type/name/label/help/condition/options/retriever) on top. So any property
   without a dedicated control (a picker's config, a container's collapse
   default) survives verbatim. Plus a **`schema_raw`** block holding a whole
   verbatim field JSON for anything unrecognized.
5. **Generators** — `buildSchema` (blockToEntry) and `buildRegistry` learn to
   emit `retriever` and merge extra props; option emission widens from
   select-only to all static option-list types.

### Components / data flow

- `blocks.js`: `FIELD_TYPES` widened; `CONTAINER_TYPES` widened; new
  `OPTION_TYPES` and `RETRIEVER_TYPES` sets; `schema_raw` block + its toolbox
  entry; `blockToEntry`/`buildRegistry` updated; `parseExtraProps(raw)` helper.
- `PropertyPanel.jsx`: show Options for OPTION_TYPES (not just select); add a
  Retriever input for RETRIEVER_TYPES; add a collapsible "Advanced (JSON)"
  extra-props textarea with parse-error feedback.
- No backend change in Phase A. Preview still renders through the real
  `Composer`, which already supports every type (retriever fetches no-op in the
  builder's `environment={}` context — acceptable, renders empty options).

### Error handling

- Extra-props JSON that doesn't parse: ignore it for emission, show an inline
  "invalid JSON" warning in the panel (don't crash the build).
- `schema_raw` with invalid JSON: same — skip, surface in the Checks tab.

### Testing

- Unit-level: a fixture schema covering each new type → `buildSchema` →
  assert the emitted object matches; round-trip an extra-props blob and assert
  it survives. (Mirror the existing `tmp/` harness style.)
- Manual: drop each new type, confirm it previews and appears in `schema.json`.

### Build order (within Phase A)

Common first: `module`, retriever selects (dynamicSelect/autocompleteSelect),
the static option-lists (radioGroup/checkboxGroup), then containers, then the
long tail (picker/uploader/unit/staticText/hidden/dynamicViewer/jobNameLocation).

## Phase B sketch (next spec)

Backend route returns an env's 4 files (system or user). JS importers mirror the
generators in reverse: schema object → field/container/raw blocks; map value →
$field/!func/text parts; template/driver lines → tmpl_*/driver_* blocks. Build a
Blockly workspace-serialization JSON and load via the existing SaveBar path.
Wire into the "Edit existing…" dropdown: if `builder.json` exists use it, else
reconstruct from files.

## Non-goals

- Phase B itself (separate spec).
- Bespoke property UIs for every exotic prop — the extra-props JSON net covers
  them; pretty controls can come later per-type as needed.
- utils.py `!func` AST discovery (still free-text).
