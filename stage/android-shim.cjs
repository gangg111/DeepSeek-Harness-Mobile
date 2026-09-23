// Android/Termux: SELinux zabrania hardlinków w katalogu danych aplikacji (link() -> EACCES).
// dsh publikuje pliki atomowo przez link(tmp, final) (no-clobber). Fallback: copyFile z COPYFILE_EXCL,
// który zachowuje semantykę "EEXIST gdy cel istnieje".
const fs = require('fs');
const { COPYFILE_EXCL } = fs.constants;
const denied = (e) => e && (e.code === 'EACCES' || e.code === 'EPERM');
const origPromise = fs.promises.link;
fs.promises.link = async function (src, dst) {
  try { return await origPromise.call(fs.promises, src, dst); }
  catch (e) { if (!denied(e)) throw e; }
  await fs.promises.copyFile(src, dst, COPYFILE_EXCL);
};
const origSync = fs.linkSync;
fs.linkSync = function (src, dst) {
  try { return origSync(src, dst); }
  catch (e) { if (!denied(e)) throw e; }
  fs.copyFileSync(src, dst, COPYFILE_EXCL);
};
fs.link = function (src, dst, cb) { fs.promises.link(src, dst).then(() => cb(null), cb); };
require('module').syncBuiltinESMExports();
