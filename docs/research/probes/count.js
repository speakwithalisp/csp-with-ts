// count macrotask hops
const o = { si: 0, st: 0 };
const si = global.setImmediate, st = global.setTimeout;
global.setImmediate = function (...a) { o.si++; return si(...a); };
global.setTimeout = function (...a) { o.st++; return st(...a); };
module.exports = o;
