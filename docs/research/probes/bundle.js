// tiny CJS bundler for the browser
const fs = require('fs'), path = require('path');
const root = path.resolve(process.argv[2]);
const mods = {};
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) mods[path.relative(root, p)] = fs.readFileSync(p, 'utf8'); } })(root);
let out = 'var CSPLIB=(function(){var M={},C={};function R(from,spec){var p=spec;if(spec[0]==="."){var b=from.split("/");b.pop();spec.split("/").forEach(function(s){if(s===".")return;if(s==="..")b.pop();else b.push(s)});p=b.filter(Boolean).join("/");if(!/\\.js$/.test(p))p+= M[p+".js"]?".js":"/index.js";}if(!M[p])throw new Error("no mod "+p+" from "+from);if(C[p])return C[p].exports;var m={exports:{}};C[p]=m;M[p](m,m.exports,function(s){return R(p,s)});return m.exports;}\n';
for (const [k, v] of Object.entries(mods)) out += `M[${JSON.stringify(k)}]=function(module,exports,require){${v}\n};\n`;
out += 'return R("","./index.js");})();';
fs.writeFileSync(process.argv[3], out);
