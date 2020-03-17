'use strict';

if (process.env.NODE_ENV === 'production') {
    var exp = require('./lib/min.index.js');
    console.log(exp);
    module.exports = exp;
} else {
    module.exports = require('./lib/index.js');
}
