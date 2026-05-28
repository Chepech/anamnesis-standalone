// Allow all build scripts
function readPackage(pkg) { return pkg; }
module.exports = { hooks: { readPackage } };
