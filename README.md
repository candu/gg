# gg: Generator General

`gg` manages generator execution in a simple, declarative manner that allows
for both serial and parallel execution of asynchronous requests.

## Platform Compatibility

`gg` has the same requirements as [`co`](https://github.com/visionmedia/co):

When using node 0.11.x or greater, you must use the `--harmony-generators` flag
or just `--harmony` to get access to generators.

When using node 0.10.x and lower or browsers without generator support, you
must use [gnode](https://github.com/TooTallNate/gnode) and/or [regenerator](https://facebook.github.io/regenerator/).

When using node 0.8.x and lower or browsers without [`setImmediate`](https://developer.mozilla.org/en-US/docs/Web/API/window.setImmediate),
you must include a [`setImmediate` polyfill](https://github.com/YuzuJS/setImmediate).

## Installing

### via npm

    npm install gg

### from source

    git clone git://github.com/candu/gg.git
    cd gg
    npm install

## Usage

These examples are adapted from `test/gg.js`, which you can run via

    npm test

### Waiting

    function* foo(value) {
      return value;
    }

    function* main() {
      var result;
      
      // use gg.wait() to wait for a single generator
      result = yield gg.wait(foo('test'));
      expect(result).to.equal('test');
      
      // use gg.waitAll() to wait for several generators (in parallel)
      result = yield gg.waitAll(foo('baz'), foo('frob'));
      expect(result).to.deep.equal(['baz', 'frob']);
      
      // you can also just pass an Array to gg.waitAll()
      result = yield gg.waitAll([foo('baz'), foo('frob')]);
      expect(result).to.deep.equal(['baz', 'frob']);

      return true;
    }

    gg.run(main(), function(err, result) {
      expect(result).to.be.true;
    });

### Error Handling

    function* bar(msg) {
      // just throw an error as you would normally
      throw new Error(msg);
    }

    function* main() {
      var threwException = false;
      try {
        var result = yield gg.wait(bar('zow'));
      } catch (err) {
        // exceptions are thrown into the waiting generator
        expect(err.message).to.equal('zow');
        threwException = true;
      }
      expect(threwException).to.be.true;
      yield gg.wait(bar('biff'));
    });
    
    gg.run(main(), function(err, result) {
      // gg.run() collects any uncaught exceptions
      expect(err.message).to.equal('biff');
    });

### Thunks and Promises

    var fs = require('fs'),
        Q = require('q');

    function sizeThunk(file) {
      return function(fn){
        fs.stat(file, function(err, stat){
          if (err) return fn(err);
          fn(null, stat.size);
        });
      }
    }
    
    function size(file, fn) {
      fs.stat(file, function(err, stat) {
        if (err) return fn(err);
        fn(null, stat.size);
      });
    }
    var sizePromise = Q.denodeify(size);

    function* main() {
      // you can also wait on thunks or promises
      var result = yield gg.waitAll(
        sizeThunk('test/gg.js'),
        sizePromise('test/gg.js'));
      expect(result[0]).to.equal(result[1]);
    }

### Dispatching

In pseudocode, the core loop of `gg` looks like this:

    while (!main.isFinished()) {    // the same main passed to gg.run()
      dispatch();                   // see below
      runOneStep();                 // run everything we can
    }

`gg.onDispatch()` allows you to attach your own functions to be called during
that `dispatch()` step.

Why would you want to do this?  Suppose you're building a web page, and you
need to fetch a bunch of users:

    function* navbar(req) {
      var user = yield gg.wait(fetchUser(uid1));
      // ...
    }

    function* feed(req) {
      var users = yield gg.waitAll([uid2, uid3, uid4].map(fetchUser));
      // ...
    }

    function* home(req) {
      var parts = yield gg.waitAll(navbar(req), feed(req)); 
      return combinePartsIntoPage(parts);
    }

Ideally, we'd fetch `uid1, ..., uid4` in one database query.  `dispatch()`
allows you to do exactly that, by providing a hook for batched operations to
execute during the core loop:

    var Users = {
      _idsToFetch: {},
      _cache: {},
      gen: function*(id) {
        if (!(id in cache)) {
          this._idsToFetch[id] = true;
        }
        gg.wait();
        return this._cache[id];
      },
      dispatch: function(done) {
        var ids = Object.keys(this._idsToFetch);
        if (ids.length === 0) return done();
        DB.getUsers(ids, function(err, results) {
          if (err) return done(err);
          ids.forEach(function(id) {
            this._cache[id] = results[id];
          }.bind(this));
          done();
        }.bind(this));
      }
    };

    var fetchUser = Users.gen;
    gg.onDispatch(Users.dispatch);

The control flow is as follows:

- all `fetchUser(uid)` calls hit `gg.wait()` and pause;
- on the next iteration of the core loop, `Users.dispatch()` is called;
- `Users.dispatch()` performs a batched DB fetch, and stores the results in
  `Users._cache`;
- the `fetchUser(uid)` calls resume, and read their return values from
  `Users._cache`.

In this way, all `fetchUser` calls across all generators can be batched into
a single DB request.

This is extremely powerful!  Now that all our user fetching is centralized,
we can add caching, logging, etc. to `Users`
*without changing the `fetchUser()` callsites*.

For another example of batched access operations in `gg`, see `DT` in
`test/gg.js`.
