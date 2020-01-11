// browserify dependencies.js > polkadot.js

let api = require("@polkadot/api");
let util = require("@polkadot/util");
let util_crypto = require("@polkadot/util-crypto");

window.api = api;
window.util = util;
window.util_crypto = util_crypto;