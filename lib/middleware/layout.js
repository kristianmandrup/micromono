/**
 * Module dependencies
 */

var assign = require('lodash.assign');

/**
 * The remote partial composing middleware
 */
module.exports = function(app) {
  return function*(next) {
    var ctx = this;
    var req = ctx.req;
    var res = ctx.res;

    var _headers;

    function writeHead(code, message, headers) {
      if (code) {
        res.status = code;
      }
      switch (typeof message) {
        case 'string':
          res.message = message;
          break;
        default:
        case 'object':
          _headers = headers;
      }

      return res;
    };

    function end(data, encoding, callback) {
      res.set('Content-Length', Buffer.byteLength(data, 'utf-8'));
      if (!res._header) {
        res._implicitHeader();
      }
      writeHead.call(res, res.status);
      write.call(res, data, encoding);
    }

    var buf = '';

    function write(body) {
      ctx.body = body;
      return true;
    };

    function endData(data, encoding) {
      if (data) {
        buf += data;
      }

      if (_headers) {
        res.set(_headers);
      }

      // merge local context and render it with template
      res.locals = assign(res.locals, {
        yield: buf
      });
      app.render('layout', res.locals, function(err, html) {
        if (err) {
          var data = err.toString();
          res.status = 500;
          res.message = 'MicroMono rendering error.';
          end(data, 'utf-8');
          return;
        }
        end(html, encoding, callback);
      });
    };

    yield next();
  };
};
