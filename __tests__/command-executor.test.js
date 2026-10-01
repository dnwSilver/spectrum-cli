#!/usr/bin/env node
jest.mock("../src/utils", () => ({
  logError: jest.fn(),
  logSuccess: jest.fn(),
}));

const { logError, logSuccess } = require("../src/utils");
const { runCommand, withCommandOptions, withDryRun, reportNoPreflights } = require("../src/command-executor");

describe("command-executor", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("runs remaining preflights after a failure and skips steps", async () => {
    const step = jest.fn();
    const laterCheck = jest.fn(() => true);
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => ({ ok: false, reason: "boom" }) }, { name: "b", run: laterCheck }],
      steps: [{ name: "step", run: step }],
    });

    expect(result).toBe(false);
    expect(laterCheck).toHaveBeenCalledTimes(1);
    expect(step).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('❌', 'Предпроверка не пройдена (%s): %s', 'a', 'boom');
    expect(logSuccess).toHaveBeenCalledWith('🔎', 'Проверено (%s): %s.', 'b', 'b');
  });

  test("runs all steps when checks pass", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => true }],
      steps: [{ name: "s1", run: () => true }, { name: "s2", run: () => true }],
    });

    expect(result).toBe(true);
    expect(logSuccess).toHaveBeenCalledWith('🔎', 'Проверено (%s): %s.', 'a', 'a');
    expect(logSuccess).toHaveBeenCalledWith("✅", "Выполнено.");
  });

  test("reports every independent check even after a failure", async () => {
    const result = await runCommand({
      name: 'chart start',
      checks: [
        { name: 'git-repo', run: () => true },
        { name: 'registry-version-missing', run: () => ({ ok: false, reason: 'already published' }) },
        { name: 'tag-missing', run: () => true },
      ],
    });

    expect(result).toBe(false);
    expect(logSuccess).toHaveBeenCalledWith('🔎', 'Проверено (%s): %s.',
      'git-repo', 'текущий каталог находится в Git-репозитории');
    expect(logSuccess).toHaveBeenCalledWith('🔎', 'Проверено (%s): %s.',
      'tag-missing', expect.any(String));
    expect(logError).toHaveBeenCalledWith('❌', 'Предпроверка не пройдена (%s): %s',
      'registry-version-missing', 'already published');
  });

  test("reports every failure, including thrown errors, and does not run steps", async () => {
    const step = jest.fn();
    const result = await withDryRun(true, () => runCommand({
      name: 'demo',
      checks: [
        { name: 'first', run: () => false },
        { name: 'second', run: () => { throw new Error('cannot inspect'); } },
        { name: 'third', run: async () => ({ ok: false, reason: 'unavailable' }) }
      ],
      steps: [{ name: 'write', run: step }]
    }));

    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledTimes(3);
    expect(logError).toHaveBeenCalledWith('❌', 'Предпроверка не пройдена (%s): %s', 'second', 'cannot inspect');
    expect(step).not.toHaveBeenCalled();
    expect(logSuccess).not.toHaveBeenCalledWith('✅', 'Все предпроверки пройдены, проблем нет. Действия не выполнялись.');
  });

  test("reports unavailable dependent checks while continuing independent checks", async () => {
    const dependent = jest.fn();
    const independent = jest.fn(() => true);
    const result = await runCommand({
      name: 'demo',
      checks: [
        { name: 'source', run: () => false },
        { name: 'dependent', dependsOn: ['source'], requires: ['version'], run: dependent },
        { name: 'independent', run: independent }
      ]
    });

    expect(result).toBe(false);
    expect(dependent).not.toHaveBeenCalled();
    expect(independent).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('❌', 'Предпроверка не выполнена (%s): %s',
      'dependent', 'не пройдены проверки: source; отсутствуют данные: version');
  });

  test("reports resolved version without dumping arbitrary preflight data", async () => {
    await runCommand({
      name: 'chart start',
      checks: [{ name: 'chart-changelog-version', run: () => ({
        ok: true, data: { version: '1.2.3', accessToken: 'secret-value' }
      }) }],
    });
    expect(logSuccess).toHaveBeenCalledWith('🔎', 'Проверено (%s): %s.',
      'chart-changelog-version',
      'версия прочитана из верхнего заголовка changelog чарта: 1.2.3');
    expect(JSON.stringify(logSuccess.mock.calls)).not.toContain('secret-value');
  });

  test("dry mode runs every preflight and skips every step", async () => {
    const checks = [jest.fn(() => ({ ok: true, data: { version: '1.2.3' } })), jest.fn((ctx) => ctx.version === '1.2.3')];
    const step = jest.fn();
    const result = await withDryRun(true, () => runCommand({
      name: 'demo',
      checks: checks.map((run, index) => ({ name: `check-${index}`, run })),
      steps: [{ name: 'write', run: step }],
    }));

    expect(result).toBe(true);
    expect(checks[0]).toHaveBeenCalledTimes(1);
    expect(checks[1]).toHaveBeenCalledTimes(1);
    expect(step).not.toHaveBeenCalled();
    expect(logSuccess).toHaveBeenCalledWith('✅', 'Все предпроверки пройдены, проблем нет. Действия не выполнялись.');
  });

  test("silence hides successful preflights but keeps the dry result", async () => {
    const check = jest.fn(() => true);
    const step = jest.fn();
    const result = await withCommandOptions({ dry: true, silence: true }, () => runCommand({
      name: 'demo',
      checks: [{ name: 'git-repo', run: check }],
      steps: [{ name: 'write', run: step }]
    }));

    expect(result).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
    expect(step).not.toHaveBeenCalled();
    expect(logSuccess).not.toHaveBeenCalledWith('🔎', expect.anything(), expect.anything(), expect.anything());
    expect(logSuccess).toHaveBeenCalledWith('✅', 'Все предпроверки пройдены, проблем нет. Действия не выполнялись.');
  });

  test("silence keeps failed preflights visible and does not affect the next command", async () => {
    const result = await withCommandOptions({ silence: true }, () => runCommand({
      name: 'demo',
      checks: [
        { name: 'passing', run: () => true },
        { name: 'failing', run: () => ({ ok: false, reason: 'boom' }) }
      ]
    }));

    expect(result).toBe(false);
    expect(logSuccess).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('❌', 'Предпроверка не пройдена (%s): %s', 'failing', 'boom');

    jest.clearAllMocks();
    await runCommand({ name: 'next', checks: [{ name: 'passing', run: () => true }] });
    expect(logSuccess).toHaveBeenCalledWith('🔎', 'Проверено (%s): %s.', 'passing', 'passing');
  });

  test("stops on failed step", async () => {
    const second = jest.fn();
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => true }],
      steps: [{ name: "s1", run: () => false }, { name: "s2", run: second }],
    });

    expect(result).toBe(false);
    expect(second).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("❌", "Шаг не выполнен: %s", "s1");
  });

  test("reports commands without preflights without repeating the command name", () => {
    reportNoPreflights("upgrade");
    expect(logSuccess).toHaveBeenCalledWith("🔎", "Предпроверок нет.");
  });

  test("fails when command name is missing", async () => {
    const result = await runCommand({});
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith("❌", "Требуется имя команды.");
  });

  test("fails when command spec is undefined", async () => {
    const result = await runCommand();
    expect(result).toBe(false);
  });

  test("normalizes string preflight result reason", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => "custom reason" }],
      steps: [{ name: "s1", run: () => true }],
    });
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith("❌", "Предпроверка не пройдена (%s): %s", "a", "custom reason");
  });

  test("normalizes object preflight result with data merge", async () => {
    const seen = [];
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => ({ ok: true, data: { v: 1 } }) }],
      steps: [{ name: "s1", run: (ctx) => { seen.push(ctx.v); return true; } }],
    });
    expect(result).toBe(true);
    expect(seen).toEqual([1]);
  });

  test("normalizes invalid preflight payload", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "a", run: () => 123 }],
      steps: [],
    });
    expect(result).toBe(false);
  });

  test("uses fallback names for missing check and step names", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ run: () => true }],
      steps: [{ run: () => true }],
    });
    expect(result).toBe(true);
    expect(logSuccess).toHaveBeenCalledWith("✅", "Выполнено.");
  });

  test("uses fallback reason for boolean false preflight", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "strict-check", run: () => false }],
      steps: [],
    });
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      "❌",
      "Предпроверка не пройдена (%s): %s",
      "strict-check",
      "Проверка не пройдена: strict-check"
    );
  });

  test("uses normalized fallback reason when preflight reason is missing", async () => {
    const result = await runCommand({
      name: "demo",
      checks: [{ name: "strict-check", run: () => ({ ok: false }) }],
      steps: [],
    });
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith(
      "❌",
      "Предпроверка не пройдена (%s): %s",
      "strict-check",
      "Проверка не пройдена: strict-check"
    );
  });
});
