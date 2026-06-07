/**
 * Env: `./configs/bootstrapEnv.js` — dùng chung với `server.js` (OTEL trước Express).
 */
require("./configs/bootstrapEnv");
require("rootpath")();

const { assertRequiredSecretsLoaded, getSessionSecret } = require("./configs/envSecrets");
assertRequiredSecretsLoaded();

// Phải load trước express: patch Router để lỗi từ async route tự động tới errorHandler
require("express-async-errors");

const express = require("express");
const router = require("routes/api");
const { swaggerUIServe, swaggerUISetup } = require("kernels/api-docs");
const authRoutes = require("routes/auth");
const userRoutes = require("routes/user");
const uploadRoutes = require('routes/uploadRoutes');
const firebaseRoutes = require("routes/firebaseRoutes");
const remoteRoutes = require("routes/remoteRoutes");
const youtubeRoutes = require("routes/youtube");
const passport = require("./configs/passport");
const { notFoundHandler, errorHandler, sendSuccess } = require("./kernels/middlewares/errorHandler");
const { configureSecurity } = require("./kernels/loaders/securityLoader");
const { configureSession } = require("./kernels/loaders/sessionLoader");
const { configureRoutes } = require("./kernels/loaders/routesLoader");

const app = express();
configureSecurity(app);
configureSession(app, getSessionSecret());

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
configureRoutes(app, {
  router,
  swaggerUIServe,
  swaggerUISetup,
  authRoutes,
  userRoutes,
  uploadRoutes,
  firebaseRoutes,
  remoteRoutes,
  youtubeRoutes,
  sendSuccess,
  notFoundHandler,
  errorHandler,
});

module.exports = app;
