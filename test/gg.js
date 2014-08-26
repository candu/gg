var gg = require('gg'),
    chai = require('chai'),
    expect = chai.expect,
    fs = require('fs'),
    Q = require('q');

describe('gg', function testGG() {
  function timeout(ms) {
    return function(callback) {
      setTimeout(callback, ms);
    }
  }

  function* sleep(ms) {
    yield gg.wait(timeout(ms));
    return true;
  }

  function* foo(value) {
    yield gg.wait(sleep(Math.floor(Math.random() * 20)));
    return value;
  }

  function* foos(values) {
    var results = yield gg.wait(values.map(foo));
    return results;
  }

  function* bar(msg) {
    throw new Error(msg);
  }

  function* baz() {
    try {
      yield gg.wait(bar('from baz'));
    } catch (err) {
      throw err;
    }
  }

  function* noop() {}

  function* noReturn() {
    yield gg.wait(foo(42));
  }

  it('.wait() works', function*() {
    var result = yield gg.wait(foo('test'));
    expect(result).to.equal('test');
  });
  it('.waitAll() works', function*() {
    var result;

    result = yield gg.waitAll(foo('bar'));
    expect(result).to.deep.equal(['bar']);

    result = yield gg.waitAll([foo('bar')]);
    expect(result).to.deep.equal(['bar']);

    result = yield gg.waitAll(foo('baz'), foo('frob'));
    expect(result).to.deep.equal(['baz', 'frob']);

    result = yield gg.waitAll([foo('baz'), foo('frob')]);
    expect(result).to.deep.equal(['baz', 'frob']);
  });
  it('implicit return works', function*() {
    var result;

    result = yield gg.wait(noop());
    expect(result).to.be.undefined;

    result = yield gg.wait(noReturn());
    expect(result).to.be.undefined;
  });
  it('exception handling works', function*() {
    var threwException = false;
    try {
      var result = yield gg.wait(bar('oops!'));
    } catch (e) {
      expect(e.message).to.equal('oops!');
      threwException = true;
    }
    expect(threwException).to.be.true;
  });
  it('exception handling works repeatedly', function*() {
    try {
      var result = yield gg.wait(bar('fool me once'));
      expect(false).to.be.true;
    } catch (e) {
      expect(e.message).to.equal('fool me once');
    }
    try {
      var result = yield gg.wait(bar('fool me twice'));
      expect(false).to.be.true;
    } catch (e) {
      expect(e.message).to.equal('fool me twice');
    }
  });
  it('multi-level exception handling works', function*() {
    var threwException = false;
    try {
      var result = yield gg.wait(baz());
    } catch (e) {
      expect(e.message).to.equal('from baz');
      threwException = true;
    }
    expect(threwException).to.be.true;
  });
  it('wait on thunk works', function*() {
    // example from https://github.com/visionmedia/co
    function size(file) {
      return function(fn){
        fs.stat(file, function(err, stat){
          if (err) return fn(err);
          fn(null, stat.size);
        });
      }
    }

    var result = yield gg.waitAll(size('test/gg.js'), size('test/gg.js'));
    expect(result.length).to.equal(2);
    expect(result[0]).to.equal(result[1]);

    var threwException = false;
    try {
      var result = yield gg.wait(size('invalid.file'));
    } catch (e) {
      threwException = true;
    }
    expect(threwException).to.be.true;
  });
  it('wait on promise works', function*() {
    function size(file, fn) {
      fs.stat(file, function(err, stat) {
        if (err) return fn(err);
        fn(null, stat.size);
      });
    }
    var sizeP = Q.denodeify(size);

    var result = yield gg.waitAll(sizeP('test/gg.js'), sizeP('test/gg.js'));
    expect(result.length).to.equal(2);
    expect(result[0]).to.equal(result[1]);

    var threwException = false;
    try {
      var result = yield gg.wait(sizeP('invalid.file'));
    } catch (e) {
      threwException = true;
    }
    expect(threwException).to.be.true;
  });
  it('wait on duplicate generator works', function*() {
    var gen = foo('test');
    var result = yield gg.waitAll(gen, gen);
    expect(result).to.deep.equal(['test', 'test']);
  });
  it('wait on repeated generator works', function*() {
    var gen = foo('test');
    var result;

    result = yield gg.wait(gen);
    expect(result).to.equal('test');

    // NOTE: the generator has already run, so we can't get another value out
    // of it.
    result = yield gg.wait(gen);
    expect(result).to.be.undefined;
  });
  it('double-run works', function(done) {
    var numDone = 0;
    gg.run(foos(['A', 'B']), function(err, result) {
      expect(result).to.deep.equal(['A', 'B']);
      if (++numDone === 2) {
        done();
      }
    });
    gg.run(foos(['C', 'D']), function(err, result) {
      expect(result).to.deep.equal(['C', 'D']);
      if (++numDone === 2) {
        done();
      }
    });
  });
  it('double-run works with exception handling', function(done) {
    var N = 100;
    function* fuzz(msg) {
      for (var i = 0; i < N; i++) {
        try {
          yield gg.wait(bar(msg));
          expect(false).to.be.true;
        } catch (e) {
          expect(e.message).to.equal(msg);
        }
      }
      return true;
    }
    var numDone = 1;
    gg.run(fuzz('A'), function(err, result) {
      if (++numDone === 2) {
        done();
      }
    });
    gg.run(fuzz('B'), function(err, result) {
      if (++numDone === 2) {
        done();
      }
    });
  });
});
