const { parseStableTag, stableTagNames } = require('../src/stable-tags');
const preflight = require('../src/preflight');
jest.mock('../src/utils', () => ({ ...jest.requireActual('../src/utils'), execSilent: jest.fn(), getMainBranch: () => 'main' }));
const { execSilent } = require('../src/utils');

afterEach(() => jest.resetAllMocks());

test.each([
    ['v1.2.3', 'release'], ['release/1.2.3', 'release'], ['hotfix/1.2.3', 'hotfix'],
])('recognizes stable tag %s', (tag, kind) => {
    expect(parseStableTag(tag)).toEqual({ version: '1.2.3', kind });
});

test.each(['1.2.3', 'release/v1.2.3', 'hotfix/01.2.3', 'release/1.2.3-rc.1', 'hotfix/1.2.3/extra', 'hotfix/TASK-1', 'release/1.2.3+build'])('rejects %s', (tag) => {
    expect(parseStableTag(tag)).toBeNull();
});

test('mixed tag prefixes share a numerically ordered baseline', () => {
    execSilent.mockReturnValueOnce('v1.2.3\nhotfix/1.2.4\nrelease/1.10.0\nv1.10.0\nrelease/9.0.0\nhotfix/2.0.0-rc.1')
        .mockReturnValueOnce('aaa refs/tags/v1.2.3\nbbb refs/tags/hotfix/1.2.4\nccc refs/tags/release/1.10.0\nccc refs/tags/v1.10.0');
    expect(preflight.requireLatestStableVersion()).toEqual({ ok: true, data: { stableVersion: '1.10.0' } });
});

test.each(stableTagNames('1.2.3'))('a remote %s prevents a second publication of the same core', (tag) => {
    execSilent.mockReturnValueOnce('').mockReturnValueOnce(`aaa refs/tags/${tag}`);
    expect(preflight.requireTagMissing('release/1.2.3').ok).toBe(false);
});

test('remote failure does not mean the version is free', () => {
    execSilent.mockReturnValueOnce('').mockReturnValueOnce(null);
    expect(preflight.requireTagMissing('release/1.2.3').ok).toBe(false);
});

test('legacy and annotated release aliases are accepted only on the same commit', () => {
    execSilent.mockReturnValueOnce('aaa').mockReturnValueOnce('aaa refs/tags/v1.2.3\nbbb refs/tags/release/1.2.3\naaa refs/tags/release/1.2.3^{}');
    expect(preflight.requireStableTagAtHead('1.2.3').ok).toBe(true);
    execSilent.mockReturnValueOnce('aaa').mockReturnValueOnce('aaa refs/tags/v1.2.3\nccc refs/tags/release/1.2.3');
    expect(preflight.requireStableTagAtHead('1.2.3').ok).toBe(false);
});
