#!/usr/bin/env node
module.exports = {
    ...require('./commands'),
    ...require('./fragments'),
    ...require('./format'),
    ...require('./release-block')
};
