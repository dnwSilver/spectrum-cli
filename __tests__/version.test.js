#!/usr/bin/env node
const fs = require("fs");

jest.mock("fs");
jest.mock("../src/utils", () => ({
  logSuccess: jest.fn(),
  logError: jest.fn(),
}));

const { logSuccess, logError } = require("../src/utils");
const version = require("../src/version");

describe("version", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("upVersion handles major/minor/patch/default", () => {
    expect(version.upVersion("1.2.3", "major")).toBe("2.0.0");
    expect(version.upVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(version.upVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(version.upVersion("1.2.3", "unknown")).toBe("1.2.4");
  });

  test("setVersion updates package.json and logs success", () => {
    fs.readFileSync.mockReturnValue('{"version":"1.2.3"}');
    fs.writeFileSync.mockImplementation(() => {});

    expect(version.setVersion("minor")).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "package.json",
      expect.stringContaining('"version": "1.3.0"')
    );
    expect(logSuccess).toHaveBeenCalledWith("🔖", "Current version %s up to %s.", "1.2.3", "1.3.0");
  });

  test("setVersion returns false on error", () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error("fail");
    });

    expect(version.setVersion("patch")).toBe(false);
    expect(logError).toHaveBeenCalledWith("❌", "Error updating version in package.json");
  });
});
