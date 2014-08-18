(function() {
  var NodeType = {
    LEAF: 1,
    WAIT: 2,
    WAITV: 3
  };

  function CallGraphNode(id, waitIds) {
    this._id = id;
    this._waitIds = {};
    if (waitIds === null) {
      this._type = NodeType.LEAF;
    } else if (!(waitIds instanceof Array)) {
      this._type = NodeType.WAIT;
      this._waitIds[waitIds] = true;
    } else {
      this._type = NodeType.WAITV;
      waitIds.forEach(function(waitId) {
        this._waitIds[waitId] = true;
      }.bind(this));
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
    return Object.keys(this._waitIds);
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
    this._gens = [];
    this._nodes = {};
    this._result = null;
    this._hasResult = false;
  }
  CallGraph.prototype.id = function(gen) {
    var genId = this._gens.indexOf(gen);
    if (genId !== -1) {
      return genId;
    }
    genId = this._gens.length;
    this._gens.push(gen);
    this.setNode(gen, null);
    return genId;
  };
  CallGraph.prototype.gen = function(genId) {
    return this._gens[genId];
  };
  CallGraph.prototype.setNode = function(gen, waitGens) {
    var genId = this.id(gen);
    this._nodes[genId] = new CallGraphNode(genId, null);
    if (waitGens === null) {
      this._nodes[genId] = new CallGraphNode(genId, null);
    } else if (!(waitGens instanceof Array)) {
      var waitId = this.id(waitGens);
      this._nodes[genId] = new CallGraphNode(genId, waitId);
    } else {
      var waitIds = waitGens.map(this.id.bind(this));
      this._nodes[genId] = new CallGraphNode(genId, waitIds);
    }
  };
  CallGraph.prototype.setError = function(gen, err) {
    var genId = this.id(gen);
    this._nodes[genId].setError(err);
  };
  CallGraph.prototype.hasError = function(gen) {
    var genId = this.id(gen);
    return this._nodes[genId].hasError();
  };
  CallGraph.prototype.error = function(gen) {
    var genId = this.id(gen);
    return this._nodes[genId].error();
  };
  CallGraph.prototype.setResult = function(gen, result) {
    var genId = this.id(gen);
    this._nodes[genId].setResult(result);
  };
  CallGraph.prototype.hasResult = function(gen) {
    var genId = this.id(gen);
    return this._nodes[genId].hasResult();
  };
  CallGraph.prototype.result = function(gen) {
    var genId = this.id(gen);
    return this._nodes[genId].result();
  };
  CallGraph.prototype.getRunnableIds = function() {
    var runnableIds = [];
    var nodeIds = Object.keys(this._nodes);
    nodeIds.forEach(function(genId) {
      var node = this._nodes[genId];
      var waitIds = node.waitIds();
      var waitGensFinished = waitIds.every(function(waitId) {
        return this._nodes[waitId].hasResult();
      }.bind(this));
      if (waitGensFinished && !node.hasError() && !node.hasResult()) {
        runnableIds.push(genId);
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
  Dispatcher.dispatch = function() {
    this._dispatchCallbacks.forEach(function(callback) {
      callback();
    });
  };
  Dispatcher.runOneStep = function(gen, sendValue) {
    var oldCurrent = this._current;
    this._current = gen;
    try {
      var yielded = gen.next(sendValue);
      if (yielded.done) {
        this._graph.setResult(gen, yielded.value);
      }
    } catch (err) {
      this._graph.setError(gen, err);
      oldCurrent.throw(err);
    } finally {
      this._current = oldCurrent;
    }
  };
  Dispatcher.wait = function(gen, waitGens) {
    this._graph.setNode(gen, waitGens);
    if (waitGens === null) {
      return;
    }
    if (!(waitGens instanceof Array)) {
      waitGens = [waitGens];
    }
    waitGens.forEach(function(waitGen) {
      this.runOneStep(waitGen);
    }.bind(this));
  };
  Dispatcher.run = function(main) {
    this._current = main;
    this.wait(main, null);
    while (!this._graph.hasResult(main)) {
      this.dispatch();
      var runnable = this._graph.getRunnableIds();
      runnable.forEach(function(genId) {
        var gen = this._graph.gen(genId);
        var sendValue = this._graph.getSendValue(gen);
        this.runOneStep(gen, sendValue);
      }.bind(this));
    }
    return this._graph.result(main);
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

  gg.run = function(main) {
    return Dispatcher.run(main);
  };

  var root = this;
  var ggOld = root.gg;

  gg.noConflict = function() {
    root.g = gOld;
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
