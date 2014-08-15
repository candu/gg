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
  var user = yield gg.wait(DT('Obj').gen(userIds[0]));
  console.log('user: ', user);
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
  it('works', function () {
    gg.onDispatch(DT.dispatch);
    debugger;
    var result = gg.run(App());
    expect(result).to.equal('w00t');
  });
});
