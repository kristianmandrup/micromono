/**
 * Module dependencies
 */

var path = require('path');
var server = require('koa');

// setup micromono
var MicroMono = require('micromono');
var Service = MicroMono.Service;
var micromono = new MicroMono();

// get passport
var passport = require('./passport');

// generate passport authentication function
var passportAuth = passport.authenticate('local', {
  successRedirect: '/account/protected',
  failureRedirect: '/account/login',
  failureFlash: false
});

function* isAuthenticated() {
  if (this.req.isAuthenticated()) {
    return true;
  } else {
    this.res.redirect('/account/login');
    return false;
  }
}

const Router = require('koa-router');

var logger = require('koa-logger');
var bodyParser = require('koa-bodyparser');

// setup a dedicated connect middleware for parsing data and session,
// so we can reuse it in the `auth` middleware and the express app.
var app = server();

// See: http://www.zev23.com/2014/03/koajs-tutorial-authenticate-with_7.html

app.use(bodyParser());
app.use(logger());

var session = require('koa-generic-session');

// TODO: use key name loaded from config file
app.keys = ['micromono'];

// TODO: load from config file!
//  5 minutes default
const maxAge = 1000 * 60 * 5;
const redisStore = require('koa-redis');

app.use(session({
  cookie: {maxAge: maxAge},
  store: redisStore
}));

app.use(passport.initialize());
app.use(passport.session());

/**
 * Account service
 */
var Account = module.exports = Service.extend({
  packagePath: __dirname,
  baseUrl: '/account',
  middleware: {
    auth: function() {
      //Middleware: authed
      function *authed(next){
        if (this.req.isAuthenticated()){
          yield next;
        } else {
          //Set redirect path in session
          this.session.returnTo = this.session.returnTo || this.req.url;
          this.redirect('/account/login');
        }
      }
    }
  },
  use: {
    // tell micromono to use `layout` middleware at the server side
    // for request url matching `/account/:page`.
    'layout': '/:page'
  },

  /**
   * Route definition property
   * @type {Object}
   */
  route: {
    /**
     * Example protected page
     */
    'get::/protected': function* protected() {
      if (isAuthenticated(this)) {
        this.res.render('hello', {
          name: this.req.user.username
        });
      }
    },

    'get::/logout': function* logout() {
      this.req.logout();
      this.res.redirect('/account/login');
    },

    'get::/login': function* login() {
      this.res.render('login');
    },

    /**
     * Login form handler
     */
    'post::/login': [passportAuth, function* loginOkay() {
      this.res.redirect('/account/protected');
    }]
  },

  init: function() {
    // get express instance
    var app = this.app;

    // setup template engine
    app.set('views', path.join(__dirname, './view'));
    app.set('view engine', 'jade');

    return Promise.resolve();
  },

  getUserById: function(id, callback) {
    if (id === 1) {
      callback({
        id: 1,
        username: 'micromono',
        password: '123456'
      });
    } else {
      callback(null);
    }
  }
});

// Start the service if this is the main file
if (require.main === module) {
  micromono.startService(Account);
}
