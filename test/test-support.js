var mocha = require('mocha');
var Runnable = mocha.Runnable;
var run = Runnable.prototype.run;
var gg = require('../gg');

/**
 * Override the Mocha function runner and enable generator support with gg.
 *
 * @param {Function} fn
 */
Runnable.prototype.run = function (fn) {
  if (this.fn.constructor.name === 'GeneratorFunction') {
    var gen = this.fn;
    this.fn = function(done) {
      gg.run(gen(), done);
    };
    this.async = true;
  }

  return run.call(this, fn);
};
