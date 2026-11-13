const S = require('./settings');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Public base URL used in QR codes, canonical links and the sitemap. Set PUBLIC_BASE_URL in production. */
const baseUrl = (req) => S.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

module.exports = { HttpError, baseUrl };
