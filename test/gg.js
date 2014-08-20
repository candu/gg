var gg = require('gg'),
    async = require('async'),
    chai = require('chai'),
    expect = chai.expect,
    fs = require('fs'),
    Q = require('q');

var DB = {
  _nextId: 1
};

function query(ids) {
  var result = {};
  ids.forEach(function fetchById(id) {
    result[id] = null;
    if (id in DB) {
      result[id] = DB[id];
    }
  });
  return result;
};

function insert(name) {
  var id = DB._nextId++;
  DB[id] = {id: id, name: name};
  return id;
}

function update(id, name) {
  if (!(id in DB)) {
    throw new Error('missing id: ' + id);
  }
  DB[id].name = name;
}

var DT = (function() {
  var _instances = {};
  var _DT = function(name) {
    if (!(name in _instances)) {
      throw new Error('no DT instance: ' + name);
    }
    return _instances[name];
  };
  _DT.register = function(name, instance) {
    _instances[name] = instance;
  };
  _DT.dispatch = function(done) {
    var instanceNames = Object.keys(_instances);
    var tasks = instanceNames.map(function(name) {
      var instance = _instances[name];
      return instance.dispatch.bind(instance);
    });
    async.parallel(tasks, done);
  };
  return _DT;
})();

function AbstractDataType() {
  this._cache = {};
  this._idsToFetch = {};
}
AbstractDataType.prototype.dispatch = function(done) {
  var ids = Object.keys(this._idsToFetch).filter(function(id) {
    var key = this.cacheKey(id);
    return !(key in this._cache);
  }.bind(this));
  this._idsToFetch = {};
  if (ids.length === 0) {
    return done();
  }
  var values = this.fetch(ids);
  ids.forEach(function(id) {
    var key = this.cacheKey(id);
    this._cache[key] = values[id];
  }.bind(this));
  done();
};
AbstractDataType.prototype.gen = function*(ids) {
  if (!(ids instanceof Array)) {
    ids = [ids];
  }
  ids.forEach(function(id) {
    this._idsToFetch[id] = true;
  }.bind(this));
  yield gg.wait();
  var objs = {};
  ids.forEach(function(id) {
    var key = this.cacheKey(id);
    objs[id] = this._cache[key];
  }.bind(this));
  return objs;
};
AbstractDataType.prototype.dirty = function(id) {
  var key = this.cacheKey(id);
  delete this._cache[key];
};

var ObjDataType = new AbstractDataType();
ObjDataType.cacheKey = function(id) {
  return 'objs:' + id;
};
ObjDataType.fetch = function(ids) {
  return query(ids);
};
DT.register('Obj', ObjDataType);

var ObjMutator = {};
ObjMutator.create = function*(name) {
  return insert(name);
};
ObjMutator.setName = function*(id, name) {
  update(id, name);
  DT('Obj').dirty(id);
};

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
  it('.onDispatch() works', function*() {
    function userValue(id, name) {
      var value = {};
      value[id] = {id: id, name: name};
      return value;
    }

    gg.onDispatch(DT.dispatch);

    var userIds = yield gg.waitAll(
      ObjMutator.create('foo'),
      ObjMutator.create('bar'));
    expect(userIds).to.deep.equal([1, 2]);

    var user = yield gg.wait(DT('Obj').gen(1));
    expect(user).to.deep.equal(userValue(1, 'foo'));

    var users = yield gg.waitAll(DT('Obj').gen(1), DT('Obj').gen(2));
    expect(users).to.deep.equal([
      userValue(1, 'foo'),
      userValue(2, 'bar')
    ]);

    yield gg.wait(ObjMutator.setName(1, 'frob'));

    users = yield gg.waitAll(userIds.map(function(userId) {
      return DT('Obj').gen(userId);
    }));
    expect(users).to.deep.equal([
      userValue(1, 'frob'),
      userValue(2, 'bar')
    ]);

    var userId = yield gg.wait(ObjMutator.create('zow'));
    expect(userId).to.equal(3);

    user = yield gg.wait(DT('Obj').gen(userId));
    expect(user).to.deep.equal(userValue(3, 'zow'));
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
