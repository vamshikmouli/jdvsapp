/**
 * Writes deploy-info.json at build time so the running app can show which
 * version is live (Settings → Deploy). Safe to fail — never blocks the build.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const sha = git('rev-parse HEAD') || process.env.DEPLOY_SHA || 'unknown';
const info = {
  sha,
  shortSha: sha.slice(0, 7),
  subject: git('log -1 --pretty=%s') || '',
  branch: git('rev-parse --abbrev-ref HEAD') || '',
  committedAt: git('log -1 --pretty=%cI') || null,
  builtAt: new Date().toISOString(),
};

try {
  fs.writeFileSync(
    path.join(process.cwd(), 'deploy-info.json'),
    JSON.stringify(info, null, 2),
  );
  console.log(`[deploy-info] ${info.shortSha} @ ${info.builtAt}`);
} catch (e) {
  console.warn('[deploy-info] could not write deploy-info.json:', e.message);
}
