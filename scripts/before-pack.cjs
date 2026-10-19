const fs = require("node:fs");

// Electron 44 can defer its binary download until first require(). Ensure the
// host runtime is present before electron-builder copies electronDist. Using
// the local distribution also avoids the builder's Windows archive rename bug.
module.exports = async () => {
  const executable = require("electron");
  if (!fs.existsSync(executable)) throw new Error("Electron runtime is missing.");
};
