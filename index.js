'use strict';

if (process.env.NODE_ENV === 'production') {
    module.exports = require('./lib/min.index.js');
} else {
    var exp = require('./lib/index.js');
    console.log(exp);
    module.exports = exp;
}
