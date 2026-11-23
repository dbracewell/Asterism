// Drops optional peer dependencies that would otherwise pull test tooling into
// the production install (US-95.1).
//
// better-auth declares `vitest` as an optional peer for its `better-auth/test`
// helpers, which Asterism never imports. Because the frontend has vitest as a
// dev dependency, pnpm resolves that peer to it, and `pnpm install --prod` then
// installs vitest, vite, jsdom and undici into the image. Removing the peer
// keeps the frontend's own vitest setup unchanged.
const DROPPED_PEERS = {
  "better-auth": ["vitest"],
};

function readPackage(pkg) {
  for (const peer of DROPPED_PEERS[pkg.name] ?? []) {
    if (pkg.peerDependencies) delete pkg.peerDependencies[peer];
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta[peer];
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
