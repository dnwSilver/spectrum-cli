#!/usr/bin/env node
const fs = require("fs");

jest.mock("fs");
jest.mock("../../src/common/utils", () => ({
  execSilent: jest.fn(),
  execCommand: jest.fn(),
  getCurrentBranch: jest.fn(),
  getMainBranch: jest.fn(),
  getDevelopBranch: jest.fn(),
}));

const utils = require("../../src/common/utils");
const preflight = require("../../src/preflight");

function normalizePath(p) {
  return String(p).replace(/\\/g, "/");
}

describe("preflight source", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utils.getMainBranch.mockReturnValue("main");
  });

  test("requireSourcePathDirectory", () => {
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ isDirectory: () => true });
    expect(preflight.requireSourcePathDirectory("/tmp/src").ok).toBe(true);

    fs.statSync.mockReturnValue({ isDirectory: () => false });
    expect(preflight.requireSourcePathDirectory("/tmp/src").ok).toBe(false);

    fs.existsSync.mockReturnValue(false);
    expect(preflight.requireSourcePathDirectory("/tmp/src").ok).toBe(false);
  });

  test("requireNextProject", () => {
    fs.existsSync.mockImplementation((p) => {
      const np = normalizePath(p);
      return np.endsWith("/package.json") || np.endsWith("/next.config.js") || np.endsWith("/yarn.lock");
    });
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: { next: "14.0.0" } }));
    expect(preflight.requireNextProject("/src").ok).toBe(true);

    fs.readFileSync.mockReturnValue("bad json");
    expect(preflight.requireNextProject("/src").ok).toBe(false);

    fs.existsSync.mockImplementation((p) => normalizePath(p).endsWith("/package.json"));
    fs.readFileSync.mockReturnValue(JSON.stringify({ dependencies: {} }));
    expect(preflight.requireNextProject("/src").ok).toBe(false);
  });

  test("requireBuildCommandSupport", () => {
    fs.existsSync.mockImplementation((p) => normalizePath(p).endsWith("/package.json"));
    fs.readFileSync.mockReturnValue(JSON.stringify({ scripts: { build: "next build" } }));
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(true);

    fs.readFileSync.mockReturnValue(JSON.stringify({ scripts: {} }));
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(false);

    fs.readFileSync.mockReturnValue("bad json");
    expect(preflight.requireBuildCommandSupport("/src").ok).toBe(false);
  });

});
