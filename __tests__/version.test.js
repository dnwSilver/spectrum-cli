#!/usr/bin/env node
const version = require("../src/version");

describe("version", () => {
  test("upVersion handles major/minor/patch/default", () => {
    expect(version.upVersion("1.2.3", "major")).toBe("2.0.0");
    expect(version.upVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(version.upVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(version.upVersion("1.2.3", "unknown")).toBe("1.2.4");
    expect(version.upVersion("1.2.3-alpha.1", "patch")).toBeNull();
  });

  test("compares stable SemVer cores", () => {
    expect(version.compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(version.compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0);
    expect(version.compareVersions("1.2.9", "2.0.0")).toBeLessThan(0);
    expect(() => version.compareVersions("1.2.3-alpha.1", "1.2.3")).toThrow();
  });

  test("parseStableVersion accepts only stable X.Y.Z cores", () => {
    expect(version.parseStableVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(version.parseStableVersion("1.2.3-rc.1")).toBeNull();
    expect(version.parseStableVersion("01.2.3")).toBeNull();
    expect(version.parseStableVersion("")).toBeNull();
  });
});
