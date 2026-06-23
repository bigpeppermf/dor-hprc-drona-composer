# PyTorch Lightning Drona Environment — Design Notes

**Date:** 2026-06-23
**Status:** Design / brainstorming output (not yet implemented)
**Author context:** Requested by boss — build a Drona PyTorch environment "starting with PyTorch Lightning."

This document captures the full discussion: the verdict on the block-code work, the
decisions made so far, the proposed design, and the open questions still to resolve.
It is a reference doc — nothing here is built yet.

---

## 1. Should this go through the Blockly "block code"? — No

**Verdict: the block builder is useful as a visualization / onboarding aid and for
simple environments, but it is NOT load-bearing for a sophisticated wrapper like this
one. The PyTorch env should be authored as real files, not blocks.**

Reasoning, grounded in the codebase:

- A Drona environment's power lives in four files (`schema.json`, `map.json`,
  `template.txt`, `driver.sh`) **plus** the parts that do the real work: `utils.py`
  (`!func()` functions such as `retrieve_tasks_and_other_resources`, `setup_python_env`),
  retriever shell scripts, and the dynamic-map mechanism (`drona_add_mapping` writing to
  `/tmp/$USER.map`).
- The block builder (`src/environmentBuilder/blocks.js` + `importEnv.js`) is a faithful
  but **thin 1:1 mapping over only the first layer**: `schema_field` / `schema_container`
  / `schema_raw`, `map_entry` with text/`$field`/`!func` parts, `tmpl_*` line blocks
  (shebang, `#SBATCH`, keyline, module, comment), and `driver_*`.
- It **explicitly falls back to raw verbatim blocks** whenever a faithful parse is not
  lossless (see comments in `importEnv.js`), and it **does not represent `utils.py`
  logic, retriever scripts, or multi-file generation at all** — exactly the parts where
  AlphaFold (and this PyTorch env) get their complexity.

**Conclusion:** keep the block builder for learning / quick simple envs; build the
PyTorch/Lightning wrapper as hand-authored files following the existing `Python/` env
patterns.

---

## 2. Decisions made

| Decision | Choice |
|---|---|
| **What the env produces** | **Both, user toggles in form.** A `mode` field: "Generate starter script" scaffolds a runnable `train.py`; "Use my own script" wraps a user-provided Lightning script. Slurm + logging + TensorBoard are shared by both modes. |
| **TensorBoard / monitoring** | **Launch TB + link from monitoring panel.** The job (or a sidecar) starts a TensorBoard server bound to the run's log dir; a Drona monitoring retriever (`staticText`, like `drona_slurm_logs.sh`) shows a clickable link/URL to reach it while training runs. |

### Wrapper-model options that were considered (for the record)

1. **Generate a Lightning training script** — Drona writes a runnable `train.py` with the
   Trainer, loggers, callbacks, and strategy fully configured from form options, plus the
   sbatch job. User supplies model/data hooks.
2. **Wrap a user-provided Lightning script** — like the existing `Python` env: user picks
   their own script; Drona only sets up module/venv, Slurm resources, env vars, logging
   dirs, and TensorBoard. No code generation.
3. **Both, user toggles in form** ✅ *(chosen)* — a `Mode` field switches between scaffold
   and bring-your-own; covers beginners and power users.

### TensorBoard options that were considered (for the record)

1. **Launch TB + link from monitoring panel** ✅ *(chosen)* — job starts `tensorboard
   --logdir=… --port=$P`; Drona monitoring panel (with `refreshInterval`) surfaces
   "TensorBoard ready: https://…node:port".
2. **Just configure TensorBoardLogger** — Drona only wires up Lightning's
   `TensorBoardLogger` / log dir and logging flags; viewing TB is left to the user.
3. **Connect to an existing TB server** — user points the env at an already-running
   TensorBoard endpoint (host/port they manage); Drona writes logs there / records the
   address.

---

## 3. Proposed design

### 3.1 File layout (a normal Drona env folder, modeled on `Python/`)

```
PyTorch-Lightning/
  schema.json          form (mode toggle + all options)
  map.json             form → vars, calls utils !funcs
  template.txt         the generated .job (sbatch headers + launch)
  driver.sh            standard sbatch submission
  utils.py             the brains (see 3.5)
  clusters/*.py        per-cluster slurm checks (reuse Python env pattern)
  additional_files/
    train_scaffold.py  templated LightningModule + DataModule + Trainer stub
    tb_launch.sh       starts tensorboard, writes node:port to run dir
  retrieve_gpus, list_accounts, get_*_env.sh   (reuse from Python env)
  monitor_tensorboard.sh   monitoring retriever → clickable TB link
```

### 3.2 Schema (form) — condition-driven

- `mode` select → `generate` | `byo`. Drives visibility of the two branches via the
  `condition` DSL (e.g. `"mode.generate"`, `"mode.byo"`).
- **Generate branch** (`condition: mode.generate`):
  experiment name, `max_epochs`, precision (`32 | 16-mixed | bf16-mixed`),
  accelerator (`auto | gpu | cpu`), strategy (`auto | ddp | fsdp | deepspeed`),
  batch size, learning rate, callbacks (ModelCheckpoint monitor / `save_top_k`,
  EarlyStopping patience, LR monitor), gradient clipping, `accumulate_grad_batches`.
  Emits a runnable `train.py` with clearly-marked `# TODO` hooks for model/data.
- **BYO branch** (`condition: mode.byo`):
  `picker` for the user's training script (like the Python env) + extra args field.
- **Shared (both modes):**
  - Environment setup (module / venv / conda for the Torch + Lightning stack) — reuse the
    `setup_python_env` pattern.
  - Slurm block: nodes, ntasks-per-node, gpus, cpus/task, mem, walltime, account,
    partition, extra Slurm params.
  - Logging: log dir, `log_every_n_steps`, loggers (TensorBoard always + optional CSV /
    WandB), log level.
  - TensorBoard: enable checkbox, auto port.

### 3.3 The correctness crux — Slurm ↔ Lightning alignment

For DDP, Lightning runs **one process per GPU**, so the Slurm request and the Trainer
config must agree:

- `--ntasks-per-node` must equal devices-per-node and match
  `Trainer(devices=N, num_nodes=M, strategy="ddp")`.
- Lightning auto-detects Slurm via `SLURMEnvironment`, so the job template launches
  training with **`srun python train.py`** (not bare `python`).
- `utils.configure_slurm()` validates `ntasks == gpus` and injects resources via
  `drona_add_mapping` — the same mechanism `retrieve_tasks_and_other_resources` already
  uses in the `Python` env.

### 3.4 TensorBoard launch + monitoring

- `tb_launch.sh` runs `tensorboard --logdir [LOGDIR] --port [PORT] --bind_all &` inside
  the job and writes `node:port` to a file in the run directory.
- `monitor_tensorboard.sh` is a `staticText` retriever with `refreshInterval` that reads
  that file + `squeue`, and renders a clickable link via OOD's node reverse-proxy
  (`/rnode/<host>/<port>`).
- **Honest caveat:** reaching a compute node from the browser depends on OOD infra (the
  reverse proxy / an interactive-app route). This is the one piece that is not pure Drona;
  document the proxy + security note when implementing.

### 3.5 `utils.py` functions

| Function | Purpose |
|---|---|
| `setup_ml_env(...)` | module / venv / conda setup for the Torch + Lightning stack |
| `configure_slurm(...)` | per-cluster validate + inject TASKS/NODES/GPUS/etc via `drona_add_mapping` |
| `build_trainer_args(...)` | produce the `Trainer(...)` kwargs string |
| `build_logger_args(...)` | TensorBoardLogger + optional CSV / WandB |
| `emit_training_script(mode, ...)` | conditionally emit `train.py` (only in generate mode) via `drona_add_additional_file` |
| `configure_tensorboard(...)` | port, launch line, proxy-URL wiring |

### 3.6 Code-generation mechanism

- The scaffold `train.py` lives as an additional file with `[PLACEHOLDER]` keys; `utils.py`
  builds the Trainer / logger / callback argument strings from form values and injects them
  via map keys.
- In **generate** mode, `emit_training_script` calls `drona_add_additional_file` to emit
  `train.py`; in **BYO** mode it is not emitted and the template runs the user's script.
- Dynamic Slurm values use `drona_add_mapping` (like `Python`); conditional file emission
  uses `drona_add_additional_file`.

### 3.7 Testing / validation

- Schema `condition` correctness (the right fields show per mode).
- Generated `train.py` is syntactically valid Python.
- Slurm ↔ Lightning device-alignment unit tests in `utils.py`.
- Dry-run preview produces a sensible `.job` + (in generate mode) `train.py`.

---

## 4. How the Drona environment model works (reference)

Captured during exploration so this doc stands alone.

- An **environment** is a folder. The engine (`machine_driver_scripts/engine.py`) loads:
  `schema.json` (form), `map.json` (form → vars), `template.txt` (job script with `[KEY]`
  placeholders), `driver.sh` (submission command), optional `utils.py`, and
  `additional_files.json` + `additional_files/`.
- **map.json** values can be: static strings, `$field` references (form values),
  `!func(args)` calls into `utils.py` (local overrides global
  `machine_driver_scripts/utils.py` → `packages/drona_utils`), or mixed expressions. The
  engine resolves `-f $field` flag patterns, `$field` refs, then `!func()` calls.
- **template.txt / driver.sh** use `[KEY]` placeholders filled from the evaluated map.
  Built-ins: `[flocation]` (run dir) and `[job-file-name]` (the `.job` name).
- **Dynamic map**: a util can call `drona_add_mapping(key, value)` (writes
  `/tmp/$USER.map`) to inject extra `[KEY]`s at preview/submit time — used for computed
  Slurm resources. `drona_add_additional_file` similarly emits extra files; `drona_add_*`
  messages surface notes/warnings/errors in the UI.
- **Retriever scripts** populate dynamic fields (`dynamicSelect`, `autocompleteSelect`,
  `staticText`, `hidden`, …). They receive `retrieverParams` as uppercased env vars plus
  context (`DRONA_ENV_DIR`, `DRONA_ENV_NAME`, `DRONA_RUNTIME_DIR`, `DRONA_WF_ID`,
  `DRONA_WF_DIR`). `staticText` + `refreshInterval` is how live monitoring panels work.
- **Reference env:** `environments-repo/Python/` — `schema.json` (job name/location,
  env-type select, script picker, uploader, Slurm row), `map.json` (calls
  `retrieve_tasks_and_other_resources` + `setup_python_env`), `template.txt` (sbatch
  headers + `[setupEnv]` + `python3 [fmainscript]`), `driver.sh` (plain `sbatch`),
  `utils.py` (cluster dispatch + Slurm validation + env setup). The PyTorch env extends
  exactly this shape.
- **Pre-built monitoring retrievers** to model the TB panel on: `drona_slurm_jobs.sh`,
  `drona_slurm_logs.sh`, `drona_slurm_sstat.sh`, `drona_slurm_nodeutil.sh`,
  `drona_slurm_seff.sh` (all `staticText` HTML).

---

## 5. Open questions (still to resolve before implementation)

1. **Cluster strategy** — the env repo has per-cluster variants (`Python`, `Python-ACES`,
   `Python-Grace`, plus `Generic-FASTER`/`-Grace`/`-Launch`/`-ACES`). Should this be **one
   cluster-aware env** (dispatch in `utils.py` like `Python/clusters/*.py`) or **per-cluster
   copies** (`PyTorch-Lightning-ACES`, `-Grace`, …)? Leaning cluster-aware single env.
2. **Loggers beyond TensorBoard** — TensorBoard is in. Also include **CSV**? **WandB**
   (needs API key handling)? Default proposal: TensorBoard always, CSV optional, WandB
   optional/later.
3. **Doc location** — this spec lives in `docs/superpowers/specs/`. Do we also want a
   user-facing version under `website/docs/environments/` once built?

---

**Texas A&M University High Performance Research Computing — Drona Workflow Engine**
