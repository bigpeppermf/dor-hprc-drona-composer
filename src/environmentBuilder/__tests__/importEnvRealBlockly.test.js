/**
 * @jest-environment jsdom
 *
 * End-to-end with REAL Blockly (headless): importEnv() JSON -> load into a real
 * Blockly.Workspace -> generators -> files. Unlike importEnv.test.js (which
 * mocks the block API), this exercises the actual deserialization path:
 * saveExtraState/loadExtraState for builderProps and the dynamic $field / [KEY]
 * dropdowns.
 */
import * as Blockly from "blockly";
import {
  defineBlocks,
  buildSchema,
  buildMap,
  buildTemplate,
  buildDriver,
  setRegistryForDropdowns,
  setMapKeysForDropdowns,
} from "../blocks";
import { importEnv, collectDropdownSeeds } from "../importEnv";

const ENV = {
  schema: {
    cores: { type: "number", name: "cores", label: "CPU cores" },
    partition: {
      type: "select", name: "partition", label: "Partition",
      options: [{ value: "gpu", label: "GPU" }, { value: "cpu", label: "CPU" }],
    },
    account: {
      type: "dynamicSelect", name: "account", label: "Account", retriever: "get_accounts",
    },
    files: { type: "picker", name: "files", label: "Files", maxCount: 4 },
  },
  map: { ntasks: "$cores", partition: "$partition", queue: "!get_queue($partition)" },
  template: ["#!/bin/bash", "#SBATCH --ntasks=[ntasks]", "[commands]"].join("\n"),
  driver: ["#!/bin/bash", "source /etc/profile", "", "cd [flocation]", "",
    "$DRONA_RUNTIME_DIR/driver_scripts/drona_wf_driver_sbatch [job-file-name]"].join("\n"),
};

describe("reverse-import through real Blockly", () => {
  let ws;
  beforeAll(() => {
    defineBlocks();
    const builder = importEnv(ENV);
    // Seed the dynamic dropdowns exactly as EnvironmentBuilder.onLoad does.
    const { fieldNames, mapKeys } = collectDropdownSeeds(builder);
    setRegistryForDropdowns(fieldNames.map((n) => ({ name: n })));
    setMapKeysForDropdowns(mapKeys);
    ws = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(builder, ws);
  });

  it("round-trips schema.json (builderProps survived save/loadExtraState)", () => {
    expect(buildSchema(ws)).toEqual(ENV.schema);
  });

  it("round-trips map.json (dynamic $field dropdown kept its value)", () => {
    expect(buildMap(ws)).toEqual(ENV.map);
  });

  it("round-trips template.txt ([KEY] dropdown kept its value)", () => {
    expect(buildTemplate(ws)).toBe(ENV.template);
  });

  it("round-trips driver.sh", () => {
    expect(buildDriver(ws)).toBe(ENV.driver);
  });
});
