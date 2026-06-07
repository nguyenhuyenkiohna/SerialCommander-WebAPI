function resolveCallbackURL() {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return process.env.GOOGLE_CALLBACK_URL.trim();
  }
  const apiBase = (process.env.API_BASE_URL || "http://localhost:2999").replace(/\/+$/, "");
  return `${apiBase}/api/auth/google/callback`;
}

function getGoogleOAuthConfig() {
  return {
    clientID: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    callbackURL: resolveCallbackURL(),
  };
}

module.exports = getGoogleOAuthConfig;
module.exports.getGoogleOAuthConfig = getGoogleOAuthConfig;
