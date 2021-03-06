// Super light-weight Flask-like server. Easier than express
// https://github.com/hapijs/hapi
import Hapi from 'hapi';

// Static file and directory handlers for hapi.js
// https://github.com/hapijs/inert
import Inert from 'inert';

// Templates rendering support for hapi.js
// https://github.com/hapijs/vision
import Vision from 'vision';

// HTTP-friendly error objects
// https://github.com/hapijs/boom
import HapiBoom from 'hapi-boom-decorators'

// Open API Swagger specs:
// https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md
// https://github.com/glennjones/hapi-swagger
import HapiSwagger from 'hapi-swagger';

// Basic API user:pass Authentication
// https://github.com/hapijs/hapi-auth-basic
import HapiBasicAuth from 'hapi-auth-basic';

// Common Hapi utilities
import Hoek from 'hoek';

import Handlebars from 'handlebars'

import {Logger} from 'cloud-core';

import Package from './package.json';
import {apiAuthenticate} from './src/authentication'
import sentryPlugin from './src/sentry'

/**
 * API Routes
 */
import registerAuthRoutes from './src/routes/auth'
import registerAdminRoutes from './src/routes/admin'
import registerPingRoutes from './src/routes/ping'
import registerDeltaRoutes from './src/routes/delta'
import registerMetadataRoutes from './src/routes/metadata'
import registerBlobsRoutes from './src/routes/blobs'
import registerHoneycombRoutes from './src/routes/honeycomb'
import registerLinkTrackingRoutes from './src/routes/link-tracking'
import registerOpenTrackingRoutes from './src/routes/open-tracking'
import registerStaticRoutes from './src/routes/static'

/**
 * API Decorators
 */
import registerLoggerDecorator from './src/decorators/logger'
import registerErrorFormatDecorator from './src/decorators/error-format'

// Swap out Node's native Promise for Bluebird, which allows us to
// do fancy things like handle exceptions inside promise blocks
global.Promise = require('bluebird');

global.Logger = Logger.createLogger('n1cloud-api')

// TODO: would be really nice if we could log some request context when
// this happens, but not sure if there's a good way to do that...
// (this can only happen in request paths during async handlers---otherwise
// hapi catches the error and transforms it into a 5xx error)
const onUnhandledError = (err) => {
  global.Logger.error(err)
}
process.on('uncaughtException', onUnhandledError)
process.on('unhandledRejection', onUnhandledError)

const server = new Hapi.Server({
  debug: { request: ['error'] },
  connections: {
    router: {
      stripTrailingSlash: true,
    },
  },
});

server.connection({ port: process.env.PORT });


// Time all requests, based on
// https://github.com/codewinds/hapi-elapsed/blob/master/lib/hapi-elapsed.js
server.on('request-internal', (request, event, tags) => {
  if (tags.received) {
    request.app.timing = { bench: new Hoek.Timer() };
  }
});

// Log every request and status code for post analysis w/log aggregation tools
server.on('request-error', (request, err) => {
  request.logger.info({
    http_status: request.response.statusCode,
    request_time_ms: request.app.timing.bench.elapsed(),
    error: err.name,
    error_message: err.message,
    error_tb: err.stack,
  }, 'request handled');
});
server.on('response', (request) => {
  if (request.response && request.response.statusCode < 500) {
    request.logger.info({
      http_status: request.response ? request.response.statusCode : null,
      request_time_ms: request.app.timing.bench.elapsed(),
    }, 'request handled');
  }
});


const plugins = [Inert, Vision, HapiBasicAuth, HapiBoom, {
  register: HapiSwagger,
  options: {
    info: {
      title: 'N1-Cloud API Documentation',
      version: Package.version,
    },
  },
}];

server.register(plugins, (err) => {
  if (err) { throw err; }

  server.auth.strategy('api-consumer', 'basic', {
    validateFunc: apiAuthenticate,
  });
  server.auth.strategy('static-password', 'basic', {
    validateFunc: (req, user, pass, cb) => {
      if (user === "nylas" && pass === "dressingontheside") {
        return cb(null, true, {})
      }
      return cb(null, false)
    },
  })
  server.auth.default('api-consumer');

  registerAuthRoutes(server)
  registerAdminRoutes(server)
  registerPingRoutes(server)
  registerDeltaRoutes(server)
  registerMetadataRoutes(server)
  registerBlobsRoutes(server)
  registerHoneycombRoutes(server)
  registerLinkTrackingRoutes(server)
  registerOpenTrackingRoutes(server)
  registerStaticRoutes(server)

  registerLoggerDecorator(server)
  registerErrorFormatDecorator(server)

  if (process.env.SENTRY_DSN) {
    server.register({
      register: sentryPlugin,
      options: {
        dsn: process.env.SENTRY_DSN,
      }});
  }

  server.views({
    engines: {
      html: Handlebars,
    },
    relativeTo: __dirname,
    path: 'src/views',
    layoutPath: 'src/views/layout',
    layout: 'default',
  });

  server.start((startErr) => {
    if (startErr) { throw startErr; }
    global.Logger.info({url: server.info.uri}, 'API running');
  });
});
