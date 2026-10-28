const functions = {
  ...require("../../src/sbom/populate"),
  ...require("../../src/sbom/provenance"),
};
const decode = (value) => {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object")
    return value.$buffer
      ? Buffer.from(value.$buffer, "base64")
      : Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, decode(v)]),
        );
  return value;
};
const vectors = require("./fixtures/python-parity.json");
describe("Python → JavaScript behaviour parity (recorded before removal)", () => {
  for (const [index, vector] of vectors.entries())
    test(`${index}: ${vector.fn} ${vector.error ? "rejects" : "accepts"}`, () => {
      const execute = () => functions[vector.fn](...decode(vector.args));
      if (vector.error) expect(execute).toThrow();
      else expect(execute()).toEqual(decode(vector.expected));
    });
});
