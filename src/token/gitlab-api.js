
async function gitlabRequest(origin, accessToken, method, apiPath, body) {
    const url = `${origin}/api/v4${apiPath}`;
    const headers = { 'PRIVATE-TOKEN': accessToken };
    const options = { method, headers };
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = null;
        }
    }

    return {
        ok: response.ok,
        status: response.status,
        data,
        headers: response.headers
    };
}

async function gitlabGetAll(origin, accessToken, apiPath) {
    const items = [];
    let page = 1;

    while (true) {
        const separator = apiPath.includes('?') ? '&' : '?';
        const result = await gitlabRequest(origin, accessToken, 'GET', `${apiPath}${separator}per_page=100&page=${page}`);
        if (!result.ok) {
            return result;
        }

        const batch = Array.isArray(result.data) ? result.data : [];
        items.push(...batch);

        const nextPage = result.headers && typeof result.headers.get === 'function'
            ? result.headers.get('x-next-page')
            : '';
        if (!nextPage) {
            break;
        }
        page = Number(nextPage);
        if (!page) {
            break;
        }
    }

    return { ok: true, status: 200, data: items };
}

module.exports = { gitlabRequest, gitlabGetAll };
