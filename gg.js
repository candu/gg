(function() {
  // TODO: "garbage collection" of unused CallGraph nodes

  var NodeType = {
    LEAF: 1,
    WAIT: 2,
    WAITV: 3
  };

  function CallGraphNode(id, waitIds) {
    this._id = id;
    this._waitIds = [];
    if (waitIds === null) {
      this._type = NodeType.LEAF;
    } else if (!(waitIds instanceof Array)) {
      this._type = NodeType.WAIT;
      this._waitIds = [waitIds];
    } else {
      this._type = NodeType.WAITV;
      this._waitIds = waitIds;
    }
    this._error = null;
    this._hasError = false;
    this._result = null;
    this._hasResult = false;
  }
  CallGraphNode.prototype.type = function() {
    return this._type;
  };
  CallGraphNode.prototype.waitIds = function() {
    return this._waitIds;
  };
  CallGraphNode.prototype.setError = function(err) {
    this._error = err;
    this._hasError = true;
  };
  CallGraphNode.prototype.hasError = function() {
    return this._hasError;
  };
  CallGraphNode.prototype.error = function() {
    return this._error;
  };
  CallGraphNode.prototype.setResult = function(result) {
    this._result = result;
    this._hasResult = true;
  };
  CallGraphNode.prototype.hasResult = function() {
    return this._hasResult;
  };
  CallGraphNode.prototype.result = function() {
    return this._result;
  };

  function CallGraph() {
    this._objs = {};
    this._nodes = {};
    this._result = null;
    this._hasResult = false;
  }
  CallGraph._NEXT_ID = 0;
  CallGraph.prototype.id = function(obj) {
    if (!('__id' in obj)) {
      obj.__id = CallGraph._NEXT_ID++;
      this._objs[obj.__id] = obj;
      this.setNode(obj, null);
    }
    return obj.__id;
  };
  CallGraph.prototype.obj = function(objId) {
    return this._objs[objId];
  };
  CallGraph.prototype.setNode = function(obj, waitGens) {
    var objId = this.id(obj);
    if (waitGens === null) {
      this._nodes[objId] = new CallGraphNode(objId, null);
    } else if (!(waitGens instanceof Array)) {
      var waitId = this.id(waitGens);
      this._nodes[objId] = new CallGraphNode(objId, waitId);
    } else {
      var waitIds = waitGens.map(this.id.bind(this));
      this._nodes[objId] = new CallGraphNode(objId, waitIds);
    }
  };
  CallGraph.prototype.setError = function(obj, err) {
    var objId = this.id(obj);
    this._nodes[objId].setError(err);
  };
  CallGraph.prototype.hasError = function(obj) {
    var objId = this.id(obj);
    return this._nodes[objId].hasError();
  };
  CallGraph.prototype.error = function(obj) {
    var objId = this.id(obj);
    return this._nodes[objId].error();
  };
  CallGraph.prototype.setResult = function(obj, result) {
    var objId = this.id(obj);
    this._nodes[objId].setResult(result);
  };
  CallGraph.prototype.hasResult = function(obj) {
    var objId = this.id(obj);
    return this._nodes[objId].hasResult();
  };
  CallGraph.prototype.result = function(obj) {
    var objId = this.id(obj);
    return this._nodes[objId].result();
  };
  CallGraph.prototype.getRunnableIds = function() {
    var runnableIds = [];
    var nodeIds = Object.keys(this._nodes);
    nodeIds.forEach(function(objId) {
      var node = this._nodes[objId];
      var waitIds = node.waitIds();
      var waitGensFinished = waitIds.every(function(waitId) {
        var waitNode = this._nodes[waitId];
        return waitNode.hasError() || waitNode.hasResult();
      }.bind(this));
      if (waitGensFinished && !node.hasError() && !node.hasResult()) {
        runnableIds.push(objId);
      }
    }.bind(this));
    return runnableIds;
  };
  CallGraph.prototype.getSendValue = function(gen) {
    var genId = this.id(gen);
    var node = this._nodes[genId];
    var waitIds = node.waitIds();
    if (node.type() === NodeType.WAIT) {
      var waitNode = this._nodes[waitIds[0]];
      return waitNode.result();
    }
    return waitIds.map(function(waitId) {
      var waitNode = this._nodes[waitId];
      return waitNode.result();
    }.bind(this));
  };

  function parallel(tasks, done) {
    var n = tasks.length;
    if (n === 0) {
      done(null, []);
    }
    var numDone = 0;
    var error = null;
    var results = new Array(n);
    tasks.forEach(function(task, i) {
      task(function(err, result) {
        if (err) {
          error = err;
        } else {
          results[i] = result;
        }
        if (++numDone === n) {
          if (error) {
            done(error);
          } else {
            done(null, results);
          }
        }
      });
    });
  }

  // NOTE: these functions are cribbed from https://github.com/visionmedia/co
  function isGenerator(obj) {
    return obj && 'function' == typeof obj.next && 'function' == typeof obj.throw;
  }

  function isPromise(obj) {
    return obj && 'function' == typeof obj.then;
  }

  function isThunk(obj) {
    return 'function' == typeof obj;
  }

  var Dispatcher = {
    _graph: new CallGraph(),
    _current: null,
    _dispatchCallbacks: []
  };
  Dispatcher.current = function() {
    return this._current;
  };
  Dispatcher.onDispatch = function(callback) {
    this._dispatchCallbacks.push(callback);
  };
  Dispatcher.dispatch = function(done) {
    parallel(this._dispatchCallbacks, done);
  };
  Dispatcher.runPromise = function(promise, done) {
    promise
      .then(function(result) {
        this._graph.setResult(promise, result);
        done();
      }.bind(this), function(err) {
        this._graph.setError(promise, err);
        this._current.throw(err);
        done();
      }.bind(this));
  };
  Dispatcher.runThunk = function(thunk, done) {
    thunk(function(err, result) {
      if (err) {
        this._graph.setError(thunk, err);
        this._current.throw(err);
      } else {
        this._graph.setResult(thunk, result);
      }
      done();
    }.bind(this));
  };
  Dispatcher.runGenerator = function(gen, done) {
    var oldCurrent = this._current;
    this._current = gen;
    try {
      var sendValue = this._graph.getSendValue(gen);
      var yielded = gen.next(sendValue);
      if (yielded.done) {
        this._graph.setResult(gen, yielded.value);
      }
    } catch (err) {
      this._graph.setError(gen, err);
      oldCurrent.throw(err);
    } finally {
      this._current = oldCurrent;
      done();
    }
  };
  Dispatcher.runOneStep = function(obj, done) {
    if (isGenerator(obj)) {
      this.runGenerator(obj, done);
    } else if (isPromise(obj)) {
      this.runPromise(obj, done);
    } else if (isThunk(obj)) {
      this.runThunk(obj, done);
    } else {
      throw new Error(
        'gg expects all runnable objects to be generators, promises, or ' +
        'thunks.');
    }
  };
  Dispatcher.wait = function(gen, waitGens) {
    this._graph.setNode(gen, waitGens);
  };
  Dispatcher.runLoop = function(main, done) {
    if (this._graph.hasError(main)) {
      return done(this._graph.error(main));
    }
    if (this._graph.hasResult(main)) {
      return done(null, this._graph.result(main));
    }
    this.dispatch(function(err) {
      if (err) {
        throw err;
      }
      var runnable = this._graph.getRunnableIds();
      var tasks = runnable.map(function(objId) {
        return function(callback) {
          var obj = this._graph.obj(objId);
          this.runOneStep(obj, callback);
        }.bind(this);
      }.bind(this));
      parallel(tasks, function(err) {
        if (err) {
          throw err;
        }
        setImmediate(function() {
          this.runLoop(main, done);
        }.bind(this));
      }.bind(this));
    }.bind(this));
  };
  Dispatcher.run = function(main, done) {
    this._current = main;
    this.wait(main, null);
    this.runLoop(main, done);
  };

  var gg = {};

  gg.wait = function(waitGen) {
    waitGen = waitGen || null;
    var gen = Dispatcher.current();
    Dispatcher.wait(gen, waitGen);
  };

  gg.waitAll = function(waitGens /* , waitGen, ... */) {
    var gen = Dispatcher.current();
    var waitGens;
    if (arguments.length === 1 && arguments[0] instanceof Array) {
      waitGens = arguments[0];
    } else {
      waitGens = Array.prototype.slice.call(arguments);
    }
    Dispatcher.wait(gen, waitGens);
  };

  gg.onDispatch = function(callback) {
    Dispatcher.onDispatch(callback);
  };

  gg.run = function(main, done) {
    Dispatcher.run(main, done);
  };

  var root = this;
  var ggOld = root.gg;

  gg.noConflict = function() {
    root.gg = ggOld;
    return this;
  };

  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = gg;
    }
    exports.gg = gg;
  } else {
    root.gg = gg;
  }

  if (typeof define === 'function' && define.amd) {
    define([], function() {
      return gg;
    });
  }
}).call(this);
