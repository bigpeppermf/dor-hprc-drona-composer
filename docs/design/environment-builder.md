# Design: Visual Environment Builder (Blockly)

Status: **Draft for review** · Author: Drona frontend revamp · Date: 2026-06-17

> Phase 1 of a two-phase "interactive GUI" effort. This doc covers the
> **Environment Builder** only. The end-user **Job Canvas** (Phase 2) reuses the
> same Blockly machinery and is sketched at the end under *Future Work*.

---

## 1. Goal

Let people author a Drona **environment** through a visual block interface
instead of hand-writing 4–5 interlocking files. The builder produces the exact
files the existing engine already consumes — **no changes to the
preview/submit pipeline**.

### Non-goals (Phase 1)

- Reverse-importing existing hand-written environments into blocks (one-way for v1).
- The end-user job-composition canvas (Phase 2).
- Replacing the form renderer or the condition DSL — we *target* them, not rewrite them.
- Authoring `utils.py` visually (free-text editor for now; blocks later).

---

## 2. Background — what an "environment" is today

An environment is a directory of hand-authored files, published via the
`dor-hprc-drona-environments` git repo. The app's `add_environment_route` only
**copies** an existing one — there is **no authoring UI**. Authoring requires
understanding all of the following by hand:

| File | Role | Builder output target |
|---|---|---|
| `schema.json` | The form: field types, containers, conditions, retrievers | **Schema blocks** |
| `map.json` | Form values → variables (`$field`, `!func()`, static, mixed) | **Map blocks** |
| `template.txt` | Job script; `[KEY]` placeholders filled from the map | **Template blocks** |
| `driver.sh` | `sbatch` submission command; also `[KEY]`-templated | **Driver blocks** |
| `utils.py` | Custom Python for `!func()` calls | Free-text editor (v1) |

Pipeline at submit time (unchanged): form values → `map.json` resolves vars →
substituted into `template.txt` (the `.job` file) and `driver.sh` → `sbatch`.

The 24 field types and 6 containers the schema supports (from
`schemaElements/index.js`):

- **Inputs**: `text`, `number`, `textarea`, `time`, `checkbox`, `select`,
  `radioGroup`, `checkboxGroup`, `picker`, `uploader`, `module`, `unit`,
  `staticText`, `hidden`
- **Dynamic (retriever-backed)**: `dynamicSelect`, `autocompleteSelect`,
  `dynamicViewer`, `dynamicRadioGroup`, `dynamicCheckboxGroup`
- **Containers**: `rowContainer`, `container`, `collapsibleRowContainer`,
  `collapsibleColContainer`, `dragDropContainer`, `jobNameLocation`

---

## 3. Why Blockly, and the layering

Blockly's one job is *compose a typed tree visually → generate text from it.*
That is exactly schema/map/template authoring. It also gives us, for free:
toolbox/palette, drag-snap with connection typing, serialization, undo/redo,
and per-language code generators.

**Layering (the connective tissue between the two phases):**

```
Phase 1  Environment Builder   palette = FIXED Drona primitives
            │  generates
            ▼
         schema.json / map.json / template.txt / driver.sh
            │  consumed by existing engine (unchanged)
            ▼
Phase 2  Job Canvas (end user)  palette = DEFINED BY the environment
```

The environment author ultimately decides which blocks an end user sees on the
job canvas. Build the block+generator infrastructure once in Phase 1; Phase 2
mostly swaps a fixed palette for a per-environment one.

---

## 4. Architecture

### 4.1 Library

- **`blockly`** (Google Blockly) + a thin React mount. Either `@blockly/react`
  or a hand-rolled `useEffect` that calls `Blockly.inject` into a ref'd div.
  Lean toward a hand-rolled mount — fewer moving parts, full control over the
  workspace lifecycle, consistent with the existing no-framework-magic codebase.
- Blockly is heavy and a **parallel paradigm** to the schema-render pipeline.
  Keep it **isolated** to the builder route; it must not leak into the runtime
  form renderer.

### 4.2 Hybrid UI (the key UX decision)

Pure Blockly is painful for editing scalar properties (label, help, options).
So:

```
┌───────────────────────────────┬───────────────────┐
│  Toolbox │   Block canvas      │  Property panel   │
│ (palette)│  (structure/nesting)│ (selected block's │
│          │                     │  scalar props)    │
├──────────┴─────────────────────┴───────────────────┤
│  Live preview: rendered form  |  generated files    │
└─────────────────────────────────────────────────────┘
```

- **Canvas/blocks** = structure & nesting only (which field, inside which
  container, in what order; which mapping; which template line).
- **Property panel** (right) = scalar props of the *selected* block: `name`,
  `label`, `help`, `condition`, `options[]`, `retriever`, default value, etc.
  React-driven, reads/writes the selected block via Blockly's API.
- **Live preview** = reuse the **existing `Composer`** to render the
  in-progress `schema.json` so authors see the real form. This is a big win and
  a reason to keep generation incremental.

### 4.3 Source of truth & data flow

- The **Blockly workspace serialization** (Blockly's JSON save state) is the
  source of truth and what we persist as the editable project (`builder.json`
  in the env dir, ignored by the engine).
- **Generators** are pure functions `workspace → fileText`:
  - `generateSchema(ws) → schema.json`
  - `generateMap(ws) → map.json`
  - `generateTemplate(ws) → template.txt`
  - `generateDriver(ws) → driver.sh`
- Regenerate on change (debounced) to drive the live preview; write all files +
  `builder.json` on **Save**.

### 4.4 Shared symbol table (field-name registry)

A cross-cutting concern: map values (`$field`), conditions
(`fieldName.expectedValue`), and template `[KEY]`s all reference names declared
elsewhere. Maintain a **registry derived from the schema blocks** (all declared
field `name`s + their option values + all map keys). Feed it into:

- the **condition** editor (dropdown of field names + values, not free text),
- the **`$field`** value block (dropdown),
- the **`[KEY]`** template reference (dropdown of map keys).

This turns the most error-prone part of hand-authoring (typos in cross-refs)
into validated dropdowns. Worth building early.

### 4.5 Block taxonomy (Phase 1)

Four toolbox categories, mirroring the four output files:

**A. Schema** — one block family for fields, one for containers.
- A generic **Field** block with a `type` dropdown keeps the palette small for
  flat scalar types; type-specific props appear in the property panel. The
  *structural* types (option-lists, retriever-backed) get dedicated blocks — see
  the granularity decision in §9.1.
- **Container** blocks (`rowContainer`, `collapsible*`, `dragDropContainer`,
  `jobNameLocation`) accept nested field/container blocks via a statement input
  → drives schema `elements` recursion.
- Every block carries optional `condition` (edited in the panel, validated
  against the registry).

**B. Map** — `KEY = <value>` mapping block; value sub-blocks:
- **static** (string), **$field** (dropdown from registry), **!function**
  (name + arg slots), **concat** (mixed list). Mirrors the 4 map value kinds.

**C. Template** — statement blocks emitting `template.txt`:
- **#SBATCH directive** blocks (time, nodes, gpus, mem, partition, account,
  mail) whose value is a `[KEY]` reference (dropdown of map keys).
- **module load**, **raw command line**, and a generic **`[KEY]` reference**.

**D. Driver** — usually trivial:
- **Standard sbatch driver** block (emits the common `cd [flocation]` +
  `drona_wf_driver_sbatch [job-file-name]`), plus an **advanced raw** block for
  custom submission logic (the AlphaFold-style multi-stage case).

### 4.6 Frontend placement

- New top-level route/page, e.g. `EnvironmentBuilder` (not inside the runtime
  `App` god-component). Reached from the existing environment UI ("Build new
  environment" next to "Import from repo").
- Self-contained: its own state, lazy-loaded chunk (Blockly is large — use a
  dynamic import / separate webpack chunk so it doesn't bloat the main bundle).

### 4.7 Backend (one new route)

- **`POST save_environment`** in `views/environments.py`: writes
  `schema.json`, `map.json`, `template.txt`, `driver.sh`, `utils.py`, and
  `builder.json` into the user's env dir (reuse `get_envs_dir()`), validating
  the env name and JSON. No other backend changes.
- **`GET load_environment_builder`** (optional, for resuming): returns
  `builder.json` for an env the user previously built.

#### Milestone 6 implementation choices (PROVISIONAL — may change)

> These two were chosen to ship M6, but are explicitly **revisitable** — the
> UX here may well change once we use it. Don't treat them as load-bearing.

- **Save location: stage-first, then promote.** The builder POSTs to a
  *staging* dir first (not straight into `get_envs_dir()`); a separate
  **promote** step moves the staged env into the user's env dir, where it
  becomes selectable in the Composer and flows through the unchanged
  preview/submit pipeline. *Down the road* we may collapse this back to a
  direct write, or add a real in-builder engine-preview against the staged dir
  instead of requiring promote-then-preview.
- **Payload: client generates the files, POSTs the strings.** The builder's JS
  generators already produce all five files, so the route just validates +
  writes the posted strings (keeping one source of generator truth in JS).
  *Down the road* we may instead POST `builder.json` and regenerate
  server-side — better for re-editing/round-trip, at the cost of duplicating
  the generators in Python. Revisit if/when round-trip editing is added.
- **`flocation` auto-entry.** Because the standard driver block emits
  `cd [flocation]`, the save step must ensure a `flocation` map entry exists
  (`"flocation": "$location"`) or the driver won't resolve. Where this injection
  lives (client vs. route) is also provisional.

---

## 5. Round-tripping decision

One-way for v1: blocks → files. Reverse-parsing arbitrary hand-written
`schema.json`/`map.json` back into blocks is a hard, lower-value problem.
Authors who use the builder keep `builder.json` as their editable source; the
generated files are treated as build artifacts. Revisit import in a later phase
if there's demand to "open" legacy environments.

---

## 6. Validation

- **Structural** (Blockly connection types): a field can't sit where a mapping
  goes, etc. — free from typed connections.
- **Semantic** (our generators): unique field `name`s; every `$field`/condition
  ref resolves in the registry; every template `[KEY]` has a map entry; required
  props present. Surface as inline warnings in the property panel + a problems
  list before Save.

---

## 7. Fit with the broader revamp

- Lives **outside** the `App` god-component → no added prop-drilling; sets the
  pattern for the eventual context/reducer extraction.
- Reuses `Composer` for live preview → exercises the schema renderer as a
  reusable unit (good pressure toward decoupling it from `App`).
- Lazy-loaded chunk → keeps Blockly's weight off the main runtime path.

---

## 8. Milestones (vertical slices)

1. **Spike**: mount Blockly in a lazy-loaded React route; 2 toy blocks + a
   generator printing to a panel. Prove the integration + chunking.
2. **Schema MVP**: generic Field block + 2–3 containers + property panel +
   `generateSchema` → live-rendered via `Composer`.
3. **Field-name registry** + condition/`$field` dropdowns.
4. **Map blocks** + `generateMap`.
5. **Template + Driver blocks** + their generators.
6. **Save**: `save_environment` route; round-trip a built env through the
   *existing* preview/submit to confirm the generated files actually run.
7. **Polish**: validation/problems panel, `utils.py` editor, resume via
   `builder.json`.

Slice 6 is the proof point — a block-built environment must preview & submit
identically to a hand-authored one.

---

## 9. Resolved decisions

### 9.1 Block granularity — generic block + a few structural blocks

**Decision:** One **generic Field block** (type dropdown) for the ~10 *flat*
types whose props are all scalars: `text`, `number`, `textarea`, `time`,
`checkbox`, `picker`, `uploader`, `unit`, `staticText`, `hidden`. Build
**dedicated blocks** only where a type carries *repeating or structural* props
that a flat property panel handles badly:

- **Option-list family** — `select`, `radioGroup`, `checkboxGroup`: each option
  is a `{value, label}` pair (plus `select`'s `showAddMore`/multi). Model
  options as **child blocks via a statement input** — Blockly's repeating
  connections beat an array editor in a side panel. *Build first.*
- **Retriever family** — `dynamicSelect`, `autocompleteSelect`,
  `dynamicViewer`, `dynamicRadioGroup`, `dynamicCheckboxGroup`: carry a
  `retriever` script path + dependency refs that must validate against the
  field-name registry (§4.4). *Build second.*
- `module` gets a dedicated block third (specialized selector semantics).

**Why:** keeps the palette small while giving real ergonomic wins exactly where
flat editing hurts. Order tracks authoring frequency. Containers are already
dedicated (they nest).

### 9.2 Schema decomposition / `$ref` — single file in v1

**Decision:** The builder emits a **single `schema.json`**; no `$ref` authoring
in v1.

**Why:** `views/schema_routes.py` resolves `$ref` server-side via
`jsonref.loads` + `convert_jsonref_to_dict` *before* the frontend ever sees the
schema — so decomposition is purely an authoring convenience and the
runtime/engine is indifferent. One workspace → one schema also keeps the
generators and the field-name registry simple. **Later:** a "linked sub-schema"
block that emits a `$ref` if shared components are wanted.

### 9.3 `utils.py` function discovery — static parse, no execution

**Decision:** The `!function` map block's name dropdown is populated by
**statically parsing `def` declarations** (prefer AST over regex — gives arg
names + defaults for arity validation). Two sources, matching the engine's
two-tier resolution:

- **Global library** (`machine_driver_scripts/utils.py` → `drona_utils`:
  `drona_add_mapping`, `drona_add_error/warning/note/message`,
  `drona_add_additional_file`, …): a curated, always-available set.
- **Env-local** `utils.py` authored in the builder's free-text editor: parsed
  live so user-defined funcs appear in the dropdown; local overrides global,
  mirroring the engine.

Validate arg **count** against the parsed signature; args are positional
strings. **Why:** the engine calls plain Python `def`s with no signature
metadata, so nothing needs to run — a parse is sufficient and safe.

### 9.4 Permissions / publishing — user-private in v1

**Decision:** Built environments are **user-private**, written only to the
user's env dir (`get_envs_dir()`). **No app-mediated writes to the shared
repo.** Publishing is **out of scope for v1.**

**Why:** `publishing.md` is an unwritten stub and `EnvironmentRepoManager` only
*copies from* the public repo — there is no existing publish path, and letting
the app push to a public multi-user repo would mean designing perms/review we
don't need yet. **Later:** an "export for contribution" action that emits a
clean env dir the author submits as a git PR to
`dor-hprc-drona-environments` — matching today's (informal, git-based) reality.

---

## 10. Future Work — Phase 2 Job Canvas

Same Blockly infra, palette **defined by an environment** instead of fixed.
End users snap together the job-step blocks the author exposed; generator emits
the script body. Inherits the one-way-generation tradeoff (breaks the current
"edit the script in CodeMirror before submit" flow — decide whether to keep an
"eject to raw script" escape hatch). Built only after Phase 1 proves the
block+generator+registry machinery.
