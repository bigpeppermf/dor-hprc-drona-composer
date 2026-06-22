/**
 * Reverse-import round-trip: files -> importEnv() -> Blockly JSON -> (mock load)
 * -> generators -> files. The output must equal the input. This is the
 * "convert & edit" fidelity guarantee.
 */
jest.mock("blockly", () => ({}), { virtual: true });

import { importEnv } from "../importEnv";
import { buildSchema, buildMap, buildTemplate, buildDriver } from "../blocks";

// Turn an importEnv serialization block into the mock-block shape the
// generators consume (mirrors how Blockly would load it).
function mockBlock(def) {
  if (!def) return null;
  const fields = def.fields || {};
  const props = def.extraState && def.extraState.props ? def.extraState.props : {};
  const inputs = def.inputs || {};
  return {
    type: def.type,
    builderProps: props,
    getFieldValue: (k) => (k in fields ? fields[k] : ""),
    getNextBlock: () => mockBlock(def.next && def.next.block),
    getInputTargetBlock: (n) => mockBlock(inputs[n] && inputs[n].block),
  };
}
function mockWorkspace(serial) {
  const tops = serial.blocks.blocks.map(mockBlock);
  return { getTopBlocks: () => tops };
}

const ENV = {
  schema: {
    cores: { type: "number", name: "cores", label: "CPU cores" },
    partition: {
      type: "select", name: "partition", label: "Partition",
      options: [{ value: "gpu", label: "GPU" }, { value: "cpu", label: "CPU" }],
    },
    account: {
      type: "dynamicSelect", name: "account", label: "Account",
      retriever: "get_accounts",
    },
    advanced: {
      type: "collapsibleRowContainer", name: "advanced", label: "Advanced",
      elements: {
        mem: { type: "number", name: "mem", label: "Memory", condition: "cores.4" },
      },
    },
    files: { type: "picker", name: "files", label: "Files", maxCount: 4 },
  },
  map: {
    ntasks: "$cores",
    partition: "$partition",
    sbatch_extra: "-N $nodes --mem=$mem",
    queue: "!get_queue($partition)",
  },
  template: [
    "#!/bin/bash",
    "#SBATCH --ntasks=[ntasks]",
    "#SBATCH --partition=[partition]",
    "module load Python",
    "# run it",
    "[commands]",
  ].join("\n"),
  driver: [
    "#!/bin/bash", "source /etc/profile", "", "cd [flocation]", "",
    "$DRONA_RUNTIME_DIR/driver_scripts/drona_wf_driver_sbatch [job-file-name]",
  ].join("\n"),
};

describe("importEnv round-trip", () => {
  const ws = mockWorkspace(importEnv(ENV));

  it("reproduces schema.json (incl. retriever, container, extra props)", () => {
    expect(buildSchema(ws)).toEqual(ENV.schema);
  });

  it("reproduces map.json (incl. $field, prefix, !func)", () => {
    expect(buildMap(ws)).toEqual(ENV.map);
  });

  it("reproduces template.txt", () => {
    expect(buildTemplate(ws)).toBe(ENV.template);
  });

  it("reproduces driver.sh (standard driver block)", () => {
    expect(buildDriver(ws)).toBe(ENV.driver);
  });
});

describe("importEnv fallbacks", () => {
  it("unknown field type becomes a lossless schema_raw block", () => {
    const env = { schema: { x: { type: "totallyCustom", name: "x", weird: true } } };
    const ws = mockWorkspace(importEnv(env));
    expect(buildSchema(ws)).toEqual(env.schema);
  });

  it("a map value that wouldn't re-join cleanly falls back to raw text", () => {
    const env = { schema: {}, map: { k: "a   b" } }; // multiple spaces
    const ws = mockWorkspace(importEnv(env));
    expect(buildMap(ws)).toEqual({ k: "a   b" });
  });
});
