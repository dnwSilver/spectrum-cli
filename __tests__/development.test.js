#!/usr/bin/env node
jest.mock("../src/utils", () => ({
  getPackageManager: jest.fn(),
  execCommand: jest.fn(),
  logError: jest.fn(),
}));

const { getPackageManager, execCommand, logError } = require("../src/utils");
const development = require("../src/development");

describe("development", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each([
    ["dev", development.dev, "npm run dev", "yarn dev"],
    ["test", development.test, "NODE_ENV=test npm run dev", "NODE_ENV=test yarn dev"],
    ["deps", development.deps, "npm install", "yarn install"],
    ["e2e", development.e2e, "npm run test:e2e", "yarn test:e2e"],
    ["e2eui", development.e2eui, "npm run test:end2end:ui", "yarn test:e2e --ui"],
  ])("%s()", (_, fn, npmCommand, yarnCommand) => {
    test("runs npm command", () => {
      getPackageManager.mockReturnValue("npm");
      execCommand.mockReturnValue(true);

      expect(fn()).toBe(true);
      expect(execCommand).toHaveBeenCalledWith(npmCommand);
    });

    test("runs yarn command", () => {
      getPackageManager.mockReturnValue("yarn");
      execCommand.mockReturnValue(true);

      expect(fn()).toBe(true);
      expect(execCommand).toHaveBeenCalledWith(yarnCommand);
    });

    test("returns false for bun and logs", () => {
      getPackageManager.mockReturnValue("bun");

      expect(fn()).toBe(false);
      expect(logError).toHaveBeenCalledWith("⚠️", "Bun not implemented");
    });

    test("returns false when package manager missing", () => {
      getPackageManager.mockReturnValue(null);

      expect(fn()).toBe(false);
      expect(logError).toHaveBeenCalledWith("⚠️", "No package manager found");
    });
  });

  test("build() runs bun build command", () => {
    getPackageManager.mockReturnValue("bun");
    execCommand.mockReturnValue(true);

    expect(development.build()).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("bun run build");
  });

  test("build() runs npm and yarn commands", () => {
    getPackageManager.mockReturnValue("npm");
    execCommand.mockReturnValue(true);
    expect(development.build()).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("npm run build");

    getPackageManager.mockReturnValue("yarn");
    execCommand.mockReturnValue(true);
    expect(development.build()).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("yarn build");
  });

  test("build() returns false when package manager missing", () => {
    getPackageManager.mockReturnValue(undefined);

    expect(development.build()).toBe(false);
    expect(logError).toHaveBeenCalledWith("⚠️", "No package manager found");
  });
});
