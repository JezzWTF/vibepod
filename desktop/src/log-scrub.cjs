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
  if (username && username.length > 2)
    result = result.replace(new RegExp(`\\b${escapeRegExp(username)}\\b`, "gi"), "<user>");
  return result;
}

module.exports = { scrubLog };
