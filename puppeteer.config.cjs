const { join } = require('path');

/**
 * Ensure Puppeteer uses a cache directory inside the project image
 * so Chrome downloaded during the Render build is available at runtime.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};

