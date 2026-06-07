const { getJwtSecret } = require("./envSecrets");

module.exports = {
  get secret() {
    return getJwtSecret();
  },
  ttl: process.env.JWT_TTL || "1d",
};
