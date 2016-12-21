'use strict';

var _ = require('lodash');
var utils = require('tartan').utils;

var defaultOptions = {
  // treat root block as infinite - may detect non-obvious folds
  allowRootReorder: true,

  // Enables extended mode - search of sub-blocks
  allowNestedBlocks: false, // fold only root

  // Next options are applicable only to extended mode:
  maxFoldLevels: 2, // fold root and up to 2 nested levels; 0 - unlimited

  // detected blocks should contain at least 3 stripes when folded
  minBlockSize: 3,

  // Example: R10 K20 Y2 G2 Y2 K20 R10
  // Non-greedy algorithm will capture only [R10 K20 Y2 G2]
  // Greedy will also produce R10 [K20 Y2 G2] R10
  greedy: false, // Capture only longest sequence

  // R15 K10 Y2 K10 R10 => R5 R10 K10 Y2 K10 R10 => R5 [R10 K10 Y2]
  allowSplitStripe: true,

  // If sett already contains some nested blocks - try to fold them too
  processExistingBlocks: true,

  // Evaluation function - should return a number that will be used to
  // compare blocks and choose the best variant
  calculateNodeWeight: utils.node.calculateNodeWeight
};

function tryFoldBlock(items) {
  // Smallest reflective sett contains 3 stripes in threadcount or
  // 5 stripes when unfolded, i.e. R/10 K2 Y/2 => R10 K2 Y2 K2 R10;
  // R/10 K/2 => R10 K2
  if ((items.length < 5) || (items.length % 2 != 1)) {
    return;
  }

  var left;
  var right;

  var result = [];
  var i = 0;
  var j = items.length - 1;
  while (true) {
    left = items[i];
    right = items[j];
    if (utils.node.isSameNode(left, right)) {
      result.push(left);
      if (i == j) {
        break;
      }
      i++;
      j--;
      continue;
    }
    return;
  }

  return result;
}

function foldRootBlock(root, options, results) {
  if (root.reflect || (root.items.length == 0)) {
    return;
  }

  var items = _.concat(root.items, root.items[0]);
  var resultItems = tryFoldBlock(items);
  if (_.isArray(resultItems)) {
    var result = _.clone(root);
    result.items = resultItems;
    result.reflect = true;
    results.push({
      node: result,
      hash: utils.node.calculateNodeHash(result),
      weight: options.calculateNodeWeight(result)
    });
  }
}

function findRootBlockVariants(root, options) {
  var results = [root];

  if (root.reflect || (root.items.length == 0) || !options.allowRootReorder) {
    return results;
  }

  var i;
  var items = _.clone(root.items);

  for (i = 0; i < items.length - 1; i++) {
    // Move first node to the end
    var temp = items[0];
    items.splice(0, 1);
    items.push(temp);

    var result = _.clone(root);
    result.items = _.clone(items);
    results.push(result);
  }

  return results;
}

function findAllPossibleVariants(items, options, results, level) {
  results.push(items);

  if (level <= 0) {
    return;
  }

  if (items.length >= options.minBlockSize * 2 - 1) {
    var from = options.minBlockSize - 1;
    var to = items.length - options.minBlockSize;
    for (var i = from; i <= to; i++) {
      tryFindNestedBlocks(i, items, _.extend({}, options, {
        allowSplitStripe: false
      }), results, level - 1);
      if (options.allowSplitStripe) {
        tryFindNestedBlocks(i, items, _.extend({}, options, {
          allowSplitStripe: true
        }), results, level - 1);
      }
    }
  }
}

function processNestedVariants(items, left, right, middle, appendToPrefix,
  prependToSuffix, options, results, level) {
  if (middle.length < options.minBlockSize) {
    return;
  }

  var prefix = items.slice(0, left >= 0 ? left + 1 : 0);
  if (appendToPrefix) {
    prefix.push(appendToPrefix);
  }

  var middleVariants = [];
  findAllPossibleVariants(middle, options, middleVariants, level);

  var suffix = items.slice(right, items.length);
  if (prependToSuffix) {
    suffix.splice(0, 0, prependToSuffix);
  }
  var suffixVariants = [];
  findAllPossibleVariants(suffix, options, suffixVariants, level);

  _.each(suffixVariants, function(variant) {
    _.each(middleVariants, function(middle) {
      results.push(_.concat(prefix,
        utils.node.newBlock(middle, true),
        variant));
    });
  });
}

function tryFindNestedBlocks(index, items, options, results, level) {
  var left;
  var right;

  left = index - 1;
  right = index + 1;
  var appendToPrefix = null;
  var prependToSuffix = null;
  var middle = [items[index]];
  var processLast = false;
  while ((left >= 0) && (right < items.length)) {
    if (utils.node.isSameNode(items[left], items[right])) {
      middle.splice(0, 0, items[left]);
    } else
    if (
      options.allowSplitStripe && items[left].isStripe &&
      items[right].isStripe && (items[left].name == items[right].name)) {
      var diff = items[left].count - items[right].count;
      if (diff > 0) {
        appendToPrefix = utils.node.newStripe({
          name: items[left].name,
          count: Math.abs(diff)
        });
      } else {
        prependToSuffix = utils.node.newStripe({
          name: items[left].name,
          count: Math.abs(diff)
        });
      }
      var node = _.clone(items[left]);
      node.count = Math.min(items[left].count, items[right].count);
      middle.splice(0, 0, node);
      left--;
      right++;
      processLast = true;
      break;
    } else {
      processLast = true;
      break;
    }
    left--;
    right++;

    if (options.greedy) {
      processNestedVariants(items, left, right, middle,
        appendToPrefix, prependToSuffix, options, results, level);
    }
  }

  if (processLast || !options.greedy) {
    processNestedVariants(items, left, right, middle,
      appendToPrefix, prependToSuffix, options, results, level);
  }
}

function findNestedBlocks(block, options, results) {
  if (block.items.length < options.minBlockSize * 2 - 1) {
    // This block cannot be folded to contain `minBlockSize` stripes as it
    // is too small
    return;
  }

  var variants = [];
  findAllPossibleVariants(block.items, options, variants,
    options.maxFoldLevels);

  _.each(variants, function(variant) {
    var result = _.clone(block);
    result.items = variant;
    results.push({
      node: result,
      hash: utils.node.calculateNodeHash(result),
      weight: options.calculateNodeWeight(result)
    });
  });
}

function processExistingBlocks(root, options, results) {
  results.push(root);

  if (
    options.allowNestedBlocks && options.processExistingBlocks &&
    options.maxFoldLevels > 1
  ) {
    var prefixes = [];
    var suffix = [];

    var modifiedOptions = _.clone(options);
    // Nested blocks are not real roots, so do not use extended algorithm
    modifiedOptions.allowRootReorder = false;
    // We already drilled down one level
    modifiedOptions.maxFoldLevels -= 1;

    _.each(root.items, function(item) {
      if (item.isBlock) {
        // Calculate variants of item
        item = _.clone(item);
        item.isRoot = true;
        var variants = processTokens(item, modifiedOptions, true);

        // Merge previous prefixes, variants of current block and suffix
        var temp = prefixes;
        prefixes = [];
        _.each(variants, function(variant) {
          variant = _.clone(variant.node);
          variant.isRoot = false;

          if (temp.length > 0) {
            _.each(temp, function(prefix) {
              prefixes.push(_.concat(prefix, suffix, variant));
            });
          } else {
            prefixes.push(_.concat(suffix, variant));
          }
        });

        // Suffix is already merged, reset it
        suffix = [];
      } else {
        suffix.push(item);
      }
    });

    _.each(prefixes, function(prefix) {
      var result = _.clone(root);
      result.items = _.concat(prefix, suffix);
      results.push(result);
    });
  }
}

function processTokens(root, options, doNotLog) {
  var variants = [{
    node: root,
    hash: utils.node.calculateNodeHash(root),
    weight: utils.node.calculateNodeWeight(root)
  }];

  var rootVariants = [];
  processExistingBlocks(root, options, rootVariants);

  var excludeHashes = [];

  _.each(rootVariants, function(root) {
    var rootVariants = findRootBlockVariants(root, options);

    // Exclude non-folded modified roots
    _.each(_.drop(rootVariants), function(root) {
      excludeHashes.push({hash: utils.node.calculateNodeHash(root)});
    });

    _.each(rootVariants, function(root) {
      foldRootBlock(root, options, variants);
      if (options.allowNestedBlocks) {
        findNestedBlocks(root, options, variants);
      }
    });
  });

  return _.chain(variants)
    .differenceBy(excludeHashes, function(item) {
      return item.hash;
    })
    .uniqBy(function(item) {
      return item.hash;
    })
    .sortBy(function(item) {
      return item.weight;
    })
    .each(function(item) {
      if (!doNotLog) {
        // Debug code, let it be here for now
        console.log(item.weight.toFixed(4),
          item.hash
            .replace(/\[R\*[0-9]+\/R[PF]:/g, '')
            .replace(/B\*[0-9]+\/R[PF]:/g, '')
            .replace(/]$/g, '')
            .replace(/[0-9]+/g, '')
        );
      }
    })
    .value();
}

function transform(sett, options) {
  var result = _.clone(sett);

  var warpIsSameAsWeft = sett.warp === sett.weft;
  if (_.isObject(sett.warp)) {
    result.warpVariants = processTokens(sett.warp, options, true);
  }
  if (_.isObject(sett.weft)) {
    if (warpIsSameAsWeft) {
      result.weftVariants = result.warpVariants;
    } else {
      result.weftVariants = processTokens(sett.weft, options, true);
    }
  }

  // Take the best variant, but keep other too
  result.warp = _.first(result.warpVariants).node;
  result.weft = _.first(result.weftVariants).node;

  return result;
}

function factory(options) {
  options = _.extend({}, defaultOptions, options);
  if (options.minBlockSize < 1) {
    options.minBlockSize = 1;
  }
  if (options.maxFoldLevels <= 0) {
    options.maxFoldLevels = 200000000; // Just a huge number
  }
  return function(sett) {
    return transform(sett, options);
  };
}

module.exports = factory;
