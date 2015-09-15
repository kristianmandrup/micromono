var path = require('path');
var isArray = require('lodash.isarray');
var server = require('koa');
// var connect = require('connect');
var getFnArgs = require('./helper').getFnArgs;
var httpProxy = require('http-proxy');
var difference = require('lodash.difference');


var Router = module.exports = function MicroMonoRouter(service) {
  this.service = service;
  var ann = service.announcement;

var server = require('koa');
  if (ann.route || service.route || service.middleware) {
    this.routeApp = server();

    if (service.middleware) {
      var middleware = service.middleware;
      this.middlewareApp = server();
      Object.keys(middleware).forEach(function(name) {
        middleware[name] = middleware[name].bind(service);
      });
    }
  }

  if (ann.client) {
    this.assetApp = server();
  }
};

Router.prototype = {

  getRoutes: function() {
    if (!this.routes) {
      this.routes = this.buildRoutes();
    }
    return this.routes;
  },

  getMiddlewares: function() {
    if (!this.middlewares) {
      this.middlewares = this.buildMiddlewares();
    }
    return this.middlewares;
  },

  getProxyHandler: function(baseUrl, allowUpgrade) {
    baseUrl = baseUrl || '/';
    var proxy = httpProxy.createProxyServer();

    proxy.on('error', function(err, req, res) {
      res.writeHead(500, {
        'Content-Type': 'text/plain'
      });

      res.end('Proxy error');
    });

    var service = this.service;

    if (allowUpgrade) {
      baseUrl = path.join(baseUrl, allowUpgrade);
      var re = new RegExp('^' + baseUrl);
      service.on('server', function(server) {
        server.on('upgrade', function(req, socket, head) {
          if (re.test(req.url)) {
            service.scheduleProvider(function(provider) {
              var target = 'http://' + provider.address + ':' + provider.webPort;
              proxy.ws(req, socket, head, {
                target: target
              });
            });
          }
        });
      });
    }

    return function*() {
      service.scheduleProvider(function(provider) {
        var target = 'http://' + provider.address + ':' + provider.webPort + baseUrl;
        proxy.web(this.req, this.res, {
          target: target
        });
      });
    };
  },

  getUpgradeHandler: function() {
    var service = this.service;
    if (!service.isRemote()) {
      return;
    }

    var ann = service.announcement;
    if (ann.allowUpgrade) {
      var handler = this.getProxyHandler(ann.baseUrl, ann.allowUpgrade);
      return handler;
    }
  },

  buildRoutes: function() {
    var _routes = {};
    var proxyHandler;
    var service = this.service;
    var ann = service.announcement;
    var isRemote = service.isRemote();

    // setup route for static asset files
    if (ann.client) {
      var assetApp = this.assetApp;
      var clientInfo = ann.client;

      if (isRemote) {
        // proxy requests for static asset
        var assetHandler = this.getProxyHandler();
        var assetPath = path.join(clientInfo.publicURL, clientInfo.name, '*');
        assetApp.get(assetPath, assetHandler.bind(service));
      } else {
        assetApp.use(service.asset.publicURL, server.static(service.asset.publicPath));
      }
    }

    if (!this.routeApp) {
      return _routes;
    }

    var routeApp = this.routeApp;
    var routes = isRemote ? ann.route : service.route;

    if (isRemote) {
      proxyHandler = this.getProxyHandler(ann.baseUrl);
    }

    routes && Object.keys(routes).forEach(function(routePath) {
      var _route;
      if (isRemote) {
        // remote service
        var routeInfo = routes[routePath];
        _route = {
          name: routePath,
          method: routeInfo.method,
          path: routeInfo.path,
          handler: proxyHandler,
          args: routeInfo.args
        };
      } else {
        // local route definition
        _route = _formatRoutePath(routePath);
        var routeHandler = routes[routePath];
        var middleware;

        if (isArray(routeHandler)) {
          middleware = routeHandler;
          routeHandler = middleware.pop();
        }

        if (typeof routeHandler === 'string') {
          routeHandler = service[routeHandler];
        }

        if (typeof routeHandler !== 'function') {
          throw new Error('Route handler for path ' + routePath + ' is not a function.');
        }

        var args = getFnArgs(routeHandler);
        if (middleware) {
          _route.middleware = middleware;
        }
        _route.handler = routeHandler;
        _route.args = args;
      }

      _routes[routePath] = _route;
      if (_route.middleware) {
        routeApp[_route.method](_route.path, _route.middleware.map(function(m) {
          return m.bind(service);
        }), _route.handler.bind(service));
      } else {
        routeApp[_route.method](_route.path, _route.handler.bind(service));
      }
    });

    var upgradeHandler = this.getUpgradeHandler();
    if (upgradeHandler) {
      routeApp.use(ann.allowUpgrade, upgradeHandler);
    }

    return _routes;
  },

  buildMiddlewares: function() {
    var service = this.service;

    if (!service.isRemote() && service.middleware) {
      var middleware = service.middleware;
      var middlewareApp = this.middlewareApp;
      var middlewares = {};
      Object.keys(middleware).forEach(function(name) {
        var fullPath = path.join('/middleware/', service.baseUrl, name);
        middlewares[name] = {
          name: name,
          path: fullPath
        };

        // @todo support middleware options
        var middlewareFn = middleware[name]();
        middlewareApp.use(fullPath, function*(next) {
          var semi = true;
          var req = this.req,
              res = this.res;

          // find out if the middleware wants to alter response
          // record changes of `req` and `req.headers`
          var reqKeys = Object.keys(req);
          var headerKeys = Object.keys(req.headers);

          middlewareFn(function(err) {
            if (err) {
              res.status = 500;
              res.message = 'MicroMono middleware error.';
              return; // next?
            }

            if (semi) {
              // using a non-exists status code to indicate that the middleware
              // does not need to change the response
              res.status = 103;

              // we only care about properties which have been added to the `req`
              // object
              var changedReqKeys = difference(Object.keys(req), reqKeys);
              var changedHeaderKeys = difference(Object.keys(req.headers), headerKeys);

              var _req = {};
              var _headers = {};

              changedReqKeys.forEach(function(key) {
                if (key !== 'read') { // @todo add more ignored names here
                  _req[key] = req[key];
                }
              });

              changedHeaderKeys.forEach(function(key) {
                _headers[key] = req.headers[key];
              });

              if (Object.keys(_headers).length > 0) {
                _req.headers = _headers;
              }

              if (Object.keys(_req).length > 0) {
                res.set('X-MicroMono-Req', JSON.stringify(_req));
              }
              return; // next?
            } else {
              // let the request go if this is a fully-remote middleware
              return; // next?
            }
          });
          yield next;
        });
      });
      return middlewares;
    }
  }
};

/**
 * MicroMonoRouter private functions.
 */

/**
 * [formatRoutePath description]
 * @param  {[type]} routePath [description]
 * @return {Object}           Route definition object
 */
function _formatRoutePath(routePath) {
  var _route = {};
  if (typeof routePath === 'string') {
    var _path = routePath.split('::');
    var method = 'get';
    if (_path.length === 2) {
      method = _path[0];
      _path = _path[1];
    } else {
      _path = routePath;
    }
    _route = {
      name: routePath,
      method: method,
      path: _path
    };
  }
  return _route;
}
