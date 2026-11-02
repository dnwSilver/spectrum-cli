#!/usr/bin/env node
module.exports = {
    ...require('./start'),
    ...require('./close'),
    ...require('./steps'),
    ...require('./version')
};
