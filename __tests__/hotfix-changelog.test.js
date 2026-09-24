const { prepareChangelog, pendingDocument } = require('../src/hotfix-changelog');

const stableText = '# Changelog\n\n## 🚀 [1.2.3] - 2026-01-01\n\n### 🪲 Fixed\n\n- Published.\n';
const fragment = { type: 'fixed', bump: 'patch', entries: ['- New correction.'] };
const pending = (body = '### 🪲 Fixed\n\n- First correction.') =>
    `# Changelog\n\n## 🚀 [1.2.4] - 2026-02-01\n\n${body}\n\n${stableText.slice(stableText.indexOf('## '))}`;
const prepare = (text, overrides = {}) => prepareChangelog({
    text, stableText, productionText: stableText, target: '1.2.4', fragments: [fragment], date: '2026-03-01', ...overrides,
});

test('retains the pending date and reads formatter-wrapped bullets', () => {
    const result = prepare(pending('### 🪲 Fixed\n\n- First correction with\n  wrapped author.'));
    expect(result).toContain('[1.2.4] - 2026-02-01');
    expect(result).toContain('- First correction with wrapped author.');
    expect(result).toContain('- New correction.');
});

test.each([
    pending().replace('[1.2.4]', '[1.3.0]'),
    pending().replace('### 🪲 Fixed', '### 🆕 Added'),
    pending().replace('First correction.', 'First correction.\nunknown unindented text'),
    pending().replace('Published.', 'Rewritten history.'),
    pending().replace('[1.2.3]', '[1.2.4]'),
    pending('### 🪲 Fixed'),
    pending().replace('[1.2.4]', '[Unreleased]'),
])('rejects invalid pending or rewritten historical sections', (text) => {
    expect(() => prepare(text)).toThrow();
});

test('does not lose notes already merged into production', () => {
    expect(() => prepare(stableText, { productionText: pending() })).toThrow(/production/);
});

test('published version cannot be reused as the next pending block', () => {
    const published = pending();
    expect(() => pendingDocument(published.replace('First correction.', 'Changed released note.'), published, '1.2.5'))
        .toThrow(/stable/);
});


test.each([
    '## [1.2.3]', '## 🚀 [1.2.3]', '## 🩹 [1.2.3]',
    '## 🚀[1.2.3] - 2022.10.25', '## 🩹 [1.2.3] - 29.03.2022',
])('preserves published legacy heading %s while creating a bandage hotfix', (heading) => {
    const history = stableText.replace('## 🚀 [1.2.3] - 2026-01-01', heading);
    const result = prepare(history, { stableText: history, productionText: history });
    expect(result).toContain('## 🩹 [1.2.4] - 2026-03-01');
    expect(result.endsWith(history.slice(history.indexOf('## ')))).toBe(true);
    expect(prepare(result, { stableText: history, productionText: history, fragments: [] })).toBe(result);
});

test('appends to an undated bandage section without inventing a date', () => {
    const text = pending().replace('## 🚀 [1.2.4] - 2026-02-01', '## 🩹 [1.2.4]');
    const result = prepare(text);
    expect(result).toContain('## 🩹 [1.2.4]\n');
    expect(result).not.toContain('[1.2.4] -');
    expect(result).toContain('- New correction.');
    expect(prepare(result, { fragments: [] })).toBe(result);
});

test('preserves historical duplicate versions but rejects new historical duplicates', () => {
    const legacy = stableText + '\n## 🩹 [1.0.0]\n\n- First.\n\n## 🩹 [1.0.0]\n\n- Second.\n';
    const result = prepare(legacy, { stableText: legacy, productionText: legacy });
    expect(result.endsWith(legacy.slice(legacy.indexOf('## ')))).toBe(true);
    expect(() => prepare(result + '\n## 🩹 [1.0.0]\n\n- Injected.\n', {
        stableText: legacy, productionText: legacy,
    })).toThrow(/stable/);
});

test('rejects duplicate undated pending hotfix sections', () => {
    const text = pending().replace('## 🚀 [1.2.4] - 2026-02-01', '## 🩹 [1.2.4]');
    expect(() => prepare(text.replace('## 🚀 [1.2.3]', '## 🩹 [1.2.4]'))).toThrow();
});

test('accepts a CRLF checkout against LF Git blobs without rewriting the historical tail', () => {
    const checkout = stableText.replace(/\n/g, '\r\n');
    const result = prepare(checkout);
    expect(result.endsWith(checkout.slice(checkout.indexOf('## ')))).toBe(true);
    expect(prepare(result, { fragments: [] })).toBe(result);
    expect(() => prepare(checkout.replace('Published.', 'Changed history.'))).toThrow(/stable/);
});
