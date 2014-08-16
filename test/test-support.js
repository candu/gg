var mocha = require('mocha');
var Runnable = mocha.Runnable;
var run = Runnable.prototype.run;
var gg = require('../gg');

/**
 * Override the Mocha function runner and enable generator support with co.
 *
 * @param {Function} fn
 */
Runnable.prototype.run = function (fn) {
  if (this.fn.constructor.name === 'GeneratorFunction') {
    var gen = this.fn;
    this.fn = function() {
      return gg.run(gen());
    };
    this.sync = true;
  }

  return run.call(this, fn);
};
