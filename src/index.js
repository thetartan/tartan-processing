'use strict';

var _ = require('lodash');
var tartan = require('tartan');

_.extend(module.exports, require('./@package'));

module.exports.filter = require('./filter');
module.exports.transform = require('./transform');

_.extend(tartan.filter, module.exports.filter);
_.extend(tartan.transform, module.exports.transform);
