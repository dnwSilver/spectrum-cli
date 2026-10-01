#!/usr/bin/env node
module.exports = {
    ...require('./result'),
    ...require('./git'),
    ...require('./changelog'),
    ...require('./tags'),
    ...require('./chart'),
    ...require('./helmrelease'),
    ...require('./source')
};
