const os = require("node:os");

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Remove the user's home folder and name from log text so it can be shared in a bug report.
function scrubLog(text, { home = os.homedir(), username = os.userInfo().username } = {}) {
  let result = text;
  if (home) {
    const forms = new Set([home, home.replaceAll("\\", "/"), home.replaceAll("\\", "\\\\")]);
    for (const form of forms) result = result.replace(new RegExp(escapeRegExp(form), "gi"), "~");
  }
  if (username && username.length > 2) {
    // \b only knows ASCII word characters, so match on Unicode letters, marks and digits instead.
    const word = "\\p{L}\\p{M}\\p{N}_";
    const pattern = `(^|[^${word}])${escapeRegExp(username)}(?=$|[^${word}])`;
    result = result.replace(new RegExp(pattern, "giu"), "$1<user>");
  }
  return result;
}

module.exports = { scrubLog };
