const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function loadAdminKey(dataDirectory) {
  const filePath = path.join(dataDirectory, 'admin.key');
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const key = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(filePath, key, { flag: 'wx', mode: 0o600 });
    return key;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return fs.readFileSync(filePath, 'utf8').trim();
  }
}

module.exports = { loadAdminKey };
