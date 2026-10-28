/** Hosts may canonicalize /index.html to /. Compare page identity, not spelling. */
export function canonicalPath(path) {
  const value = String(path).split(/[?#]/)[0];
  return (value.replace(/\/index(?:\.html)?\/?$/,'/').replace(/\.html$/,'').replace(/\/+$/,'') || '/');
}
export function samePage(a,b) { return canonicalPath(a) === canonicalPath(b); }
export function validEntry(path) { return /^\/games\/[a-z0-9_-]+\/[a-f0-9]{16}\/index\.html$/.test(path || ''); }
export function transportPath(entry) {
  if (!validEntry(entry)) throw new Error('Сервер вернул некорректный адрес игровой сборки.');
  return entry;
}
