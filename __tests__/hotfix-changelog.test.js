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
