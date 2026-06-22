/**
 * Phase A: schema generation for the widened field palette. We mock `blockly`
 * (defineBlocks isn't exercised here — we test the pure tree-walk generators)
 * and feed hand-built mock blocks to buildSchema.
 */
jest.mock("blockly", () => ({}), { virtual: true });

import { buildSchema, parseExtraProps } from "../blocks";

// Minimal mock matching the block API the generators use.
function field(type, name, props = {}, next = null) {
  return {
    type: "schema_field",
    builderProps: props,
    getFieldValue: (k) => (k === "TYPE" ? type : k === "NAME" ? name : ""),
    getNextBlock: () => next,
    getInputTargetBlock: () => null,
  };
}
function raw(name, json, next = null) {
  return {
    type: "schema_raw",
    getFieldValue: (k) => (k === "NAME" ? name : k === "JSON" ? json : ""),
    getNextBlock: () => next,
  };
}
const ws = (top) => ({ getTopBlocks: () => top });

describe("parseExtraProps", () => {
  it("parses an object, rejects junk/arrays", () => {
    expect(parseExtraProps('{"a":1}')).toEqual({ a: 1 });
    expect(parseExtraProps("")).toEqual({});
    expect(parseExtraProps("not json")).toEqual({});
    expect(parseExtraProps("[1,2]")).toEqual({});
  });
});

describe("buildSchema — widened palette", () => {
  it("emits options for every option-list type (not just select)", () => {
    const s = buildSchema(ws([field("radioGroup", "r", { options: "a|A\nb|B" })]));
    expect(s.r.type).toBe("radioGroup");
    expect(s.r.options).toEqual([
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
  });

  it("emits retriever for retriever-backed types", () => {
    const s = buildSchema(ws([field("dynamicSelect", "p", { retriever: "get_parts" })]));
    expect(s.p.retriever).toBe("get_parts");
  });

  it("does not attach a retriever to a plain field", () => {
    const s = buildSchema(ws([field("text", "t", {})]));
    expect(s.t.retriever).toBeUndefined();
  });

  it("spreads extra-props JSON but lets dedicated keys win (lossless)", () => {
    const s = buildSchema(
      ws([field("picker", "f", { label: "Pick", extraProps: '{"maxCount":4,"type":"IGNORED"}' })])
    );
    expect(s.f.maxCount).toBe(4); // survived
    expect(s.f.type).toBe("picker"); // dedicated key overrides the blob
    expect(s.f.label).toBe("Pick");
  });

  it("schema_raw round-trips verbatim JSON keyed by name", () => {
    const s = buildSchema(ws([raw("weird", '{"type":"jobNameLocation","x":1}')]));
    expect(s.weird).toEqual({ name: "weird", type: "jobNameLocation", x: 1 });
  });
});
