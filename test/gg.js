var gg = require('gg'),
    chai = require('chai'),
    expect = chai.expect,
    fs = require('fs'),
    Q = require('q');

describe('gg', function testGG() {
  function* foo(value) {
    return value;
  }

  function* bar() {
    throw new Error('oops.');
  }

  function* baz() {
    try {
      yield gg.wait(bar());
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
      var result = yield gg.wait(bar());
    } catch (e) {
      threwException = true;
    }
    expect(threwException).to.be.true;
  });
  it('multi-level exception handling works', function*() {
    var threwException = false;
    try {
      var result = yield gg.wait(baz());
    } catch (e) {
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
});
