const { API } = require("../../src/security/runtime");
const { Tracker } = require("../../src/security/tracker");
const response = (value) => ({
  status: 400,
  headers: new Headers(),
  body: Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
});
test.each([
  [{ error: "invalid_field", error_description: "Cannot resolve value Group for field Type" }, "Cannot resolve value Group for field Type"],
  [{ message: { variables: ["field is required"] } }, '"variables":["field is required"]'],
  [{ error: "invalid_request" }, "invalid_request"],
])("API validation errors expose endpoint and server reason without retrying writes: %j", async (body, reason) => {
  const transport = jest.fn(async () => response(body));
  const api = new API("https://issues.example/api", {}, transport);
  let error;
  try { await api.post("issues", { privatePayload: "must-not-print" }); }
  catch (caught) { error = caught; }
  expect(error.status).toBe(400);
  expect(error.message).toContain("POST failed (HTTP 400) at https://issues.example/api/issues");
  expect(error.message).toContain(reason);
  expect(error.message).not.toContain("must-not-print");
  expect(transport).toHaveBeenCalledTimes(1);
});
test("API errors redact credentials from headers and omit the query", async () => {
  const bearer = "perm:private:credential";
  const token = "private-header-token";
  const transport = jest.fn(async () => response({
    error_description: `invalid ${bearer}; Bearer ${bearer}; ${token}`,
  }));
  const api = new API("https://issues.example/api", {
    Authorization: "Bearer " + bearer,
    "PRIVATE-TOKEN": token,
  }, transport);
  let error;
  try { await api.get("issues", { query: { sensitive: "query-secret" } }); }
  catch (caught) { error = caught; }
  expect(error.message).toContain("[REDACTED]");
  for (const secret of [bearer, token, "query-secret", "sensitive"])
    expect(error.message).not.toContain(secret);
});
test.each(["<html>private proxy diagnostics</html>", { other: "private response data" }])("unrecognized responses do not dump arbitrary response content: %j", async (body) => {
  const api = new API("https://issues.example/api", {}, async () => response(body));
  await expect(api.post("issues", {})).rejects.toThrow("HTTP 400");
  try { await api.post("issues", {}); }
  catch (error) { expect(error.message).not.toContain("private"); }
});
test("long server diagnostics remain bounded", async () => {
  const api = new API("https://issues.example/api", {}, async () => response({ error_description: "x".repeat(10000) }));
  try { await api.post("issues", {}); }
  catch (error) { expect(error.message.length).toBeLessThan(2100); }
});
test("creation failure identifies the destination project and preserves HTTP status", async () => {
  const failure = Object.assign(Error("API POST failed (HTTP 400) at https://issues.example/api/issues: required field"), { status: 400 });
  const api = {
    get: jest.fn(async () => [{ id: "0-1", shortName: "APP" }]),
    request: jest.fn(async () => { throw failure; }),
  };
  const tracker = new Tracker(api, "https://issues.example", {});
  await expect(tracker.create("APP", "summary", "description")).rejects.toMatchObject({
    status: 400,
    message: expect.stringContaining("Create YouTrack issue in APP: API POST failed (HTTP 400)"),
  });
  expect(api.request).toHaveBeenCalledTimes(1);
});

test("YouTrack numeric HTML error entities are readable and decoded credentials stay masked", async () => {
  const token = "token-sensitive";
  const encodedToken = Array.from(token, (char) => "&#" + char.codePointAt(0) + ";").join("");
  const api = new API("https://issues.example/api", { Authorization: "Bearer " + token }, async () => response({
    error_description: "&#1054;&#1078;&#1080;&#1076;&#1072;&#1077;&#1090;&#1089;&#1103; &#x54;ester: " + encodedToken + " &#99999999;",
  }));
  let error;
  try { await api.post("commands", {}); }
  catch (caught) { error = caught; }
  expect(error.message).toContain("Ожидается Tester: [REDACTED]");
  expect(error.message).toContain("&#99999999;");
  expect(error.message).not.toContain(token);
  expect(error.message).not.toContain(encodedToken);
});
