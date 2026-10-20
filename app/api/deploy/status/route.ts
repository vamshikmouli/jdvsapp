import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requirePermission, authErrorResponse } from '@/lib/rbac/roles';

export const dynamic = 'force-dynamic';

interface DeployInfo {
  sha: string;
  shortSha: string;
  subject: string;
  branch: string;
  committedAt: string | null;
  builtAt: string | null;
}

function readInfo(): DeployInfo | null {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'deploy-info.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// The detached deploy writes ~/deploy.log (one level above the app's cwd on the VM)
// with SIG_DEPLOY_DONE_OK / SIG_DEPLOY_FAILED markers. We read the tail to show the
// last result and whether a build is currently running.
function readLogStatus(): { status: 'building' | 'success' | 'failed' | 'idle'; logAt: string | null; tail: string[] } {
  const candidates = [
    path.join(process.cwd(), '..', 'deploy.log'),
    path.join(process.cwd(), 'deploy.log'),
  ];
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      const buf = fs.readFileSync(file, 'utf8');
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const tail = lines.slice(-12);
      const joined = tail.join('\n');
      const lastLine = tail[tail.length - 1] || '';
      const recent = Date.now() - stat.mtimeMs < 25 * 60 * 1000; // modified in last 25 min

      let status: 'building' | 'success' | 'failed' | 'idle';
      if (/SIG_DEPLOY_FAILED/.test(lastLine)) status = 'failed';
      else if (/SIG_DEPLOY_DONE_OK/.test(lastLine)) status = 'success';
      else if (recent) status = 'building';
      else if (/SIG_DEPLOY_FAILED/.test(joined) && !/SIG_DEPLOY_DONE_OK/.test(joined)) status = 'failed';
      else if (/SIG_DEPLOY_DONE_OK/.test(joined)) status = 'success';
      else status = 'idle';

      return { status, logAt: new Date(stat.mtimeMs).toISOString(), tail };
    } catch {
      // try next candidate
    }
  }
  return { status: 'idle', logAt: null, tail: [] };
}

// GET /api/deploy/status — admin only
export async function GET() {
  try {
    await requirePermission('SETTINGS_MANAGE');
    const info = readInfo();
    const log = readLogStatus();
    return NextResponse.json({
      info,
      status: log.status,
      logAt: log.logAt,
      tail: log.tail,
      env: process.env.NODE_ENV || 'development',
      serverNow: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    });
  } catch (err) {
    const { status, body } = authErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
