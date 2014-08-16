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
  yield gg.result(objs);
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
  yield gg.result(insert(name));
};
ObjMutator.setName = function*(id, name) {
  update(id, name);
  DT('Obj').dirty(id);
  yield gg.result(null);
};

function* initDB() {
  var userIds = yield gg.waitAll(
      ObjMutator.create('foo'),
      ObjMutator.create('bar'));
  yield gg.result(userIds);
}

function* App() {
  var userIds = yield gg.wait(initDB());
  console.log(userIds);
  var user = yield gg.wait(DT('Obj').gen(userIds[0]));
  console.log(user);
  var users = yield gg.waitAll(userIds.map(function(userId) {
    return DT('Obj').gen(userId);
  }));
  console.log('users: ', users);
  yield gg.wait(ObjMutator.setName(1, 'baz'));
  users = yield gg.waitAll(userIds.map(function(userId) {
    return DT('Obj').gen(userId);
  }));
  console.log('users: ', users);
  var userId = yield gg.wait(ObjMutator.create('frob'));
  user = yield gg.wait(DT('Obj').gen(userId));
  console.log('user: ', user);
  yield gg.result('w00t');
}

describe('gg', function testGG() {
  function* foo(value) {
    yield gg.result(value);
  }

  function* bar() {
    throw new Error('oops.');
  }

  function* noop() {}

  function* noResult() {
    yield gg.wait(foo(42));
  }

  it('.wait() works', function*() {
    var result = yield gg.wait(foo('test'));
    expect(result).to.equal('test');
    yield gg.result(true);
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

    yield gg.result(true);
  });
  it('.result() must be called', function() {
    expect(function() {
      gg.run(noop());
    }).to.throw(Error);
    expect(function() {
      gg.run(noResult());
    }).to.throw(Error);
  });
  it('exception handling works', function*() {
    var threwException = false;
    try {
      var result = yield gg.wait(bar());
    } catch (e) {
      threwException = true;
    }
    expect(threwException).to.be.true;
    yield gg.result(true);
  });
  it('.onDispatch() works', function() {
    gg.onDispatch(DT.dispatch);
    var result = gg.run(App());
    expect(result).to.equal('w00t');
  });
});
