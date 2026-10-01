
function parseGitlabUrl(raw) {
    const url = new URL(String(raw || '').trim());
    const pathname = url.pathname.replace(/^\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!url.origin || !pathname) {
        throw new Error('invalid gitlab url');
    }
    return {
        origin: url.origin,
        path: pathname,
        encodedPath: encodeURIComponent(pathname),
        url: String(raw).trim()
    };
}

module.exports = { parseGitlabUrl };
