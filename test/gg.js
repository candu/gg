var gg = require('../gg'),
    chai = require('chai'),
    expect = chai.expect;

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
  _DT.dispatch = function() {
    var instanceNames = Object.keys(_instances);
    instanceNames.forEach(function(name) {
      var instance = _instances[name];
      instance.dispatch();
    });
  };
  return _DT;
})();

function AbstractDataType() {
  this._cache = {};
  this._idsToFetch = {};
}
AbstractDataType.prototype.dispatch = function() {
  var ids = Object.keys(this._idsToFetch).filter(function(id) {
    var key = this.cacheKey(id);
    return !(key in this._cache);
  }.bind(this));
  this._idsToFetch = {};
  if (ids.length === 0) {
    return;
  }
  var values = this.fetch(ids);
  ids.forEach(function(id) {
    var key = this.cacheKey(id);
    this._cache[key] = values[id];
  }.bind(this));
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
  it('implicit return works', function() {
    expect(gg.run(noop())).to.be.undefined;
    expect(gg.run(noReturn())).to.be.undefined;
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
});
