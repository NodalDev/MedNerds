import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { repositoryManifest } from './prepare-meddocs-comments-sync.mjs';
import { validateArticleManifest } from '../src/lib/meddocs/comments/articles.ts';

export const PRODUCTION_PROJECT = 'hwuqqeixfxnyvpzwyjvq';

export function syncConfiguration(env) {
  if (env.CONTEXT && env.CONTEXT !== 'production') throw new Error('Comment sync is forbidden in preview/branch builds.');
  if (env.MEDDOCS_COMMENTS_SYNC_ENABLED !== 'true') throw new Error('Production comment sync requires explicit server-side enablement.');
  const url = env.PUBLIC_SUPABASE_URL;
  if (url !== `https://${PRODUCTION_PROJECT}.supabase.co`) throw new Error('Comment sync requires the exact Production URL.');
  const secret = env.MEDDOCS_COMMENTS_SYNC_SECRET_KEY?.trim();
  // Require modern server-only credentials; publishable keys and user JWTs are never accepted.
  if (!secret?.startsWith('sb_secret_')) throw new Error('A server-only Supabase secret key is required.');
  return { url, secret };
}

export async function syncArticles({ env = process.env, dryRun = false,
  manifestPath = '.astro/meddocs-comments-manifest.json', root = process.cwd(),
  clientFactory = createClient } = {}) {
  // Compare build output with current sources BEFORE creating any authenticated client.
  const manifest = validateArticleManifest(JSON.parse(await readFile(resolve(root, manifestPath), 'utf8')), await repositoryManifest(root));
  if (!manifest.length) throw new Error('Refusing an empty complete deployment manifest.');
  const result = { total: manifest.length, enabled: manifest.filter(row => row.comments_enabled).length, dryRun };
  if (dryRun) return result;
  const { url, secret } = syncConfiguration(env);
  const client = clientFactory(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let response;
  try { response = await client.rpc('meddocs_articles_sync', { manifest }); }
  catch { throw new Error('Production article sync failed. No provider diagnostics are printed.'); }
  if (response.error) throw new Error('Production article sync was rejected. Check the follow-up migration and server-side configuration.');
  if (response.data !== manifest.length) throw new Error('Unexpected sync count; stop the deployment and review the catalog.');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--dry-run')) {
    console.error('Usage: sync-meddocs-comments.mjs [--dry-run]'); process.exitCode = 1;
  } else {
    syncArticles({ dryRun: args[0] === '--dry-run' }).then(result => {
      console.log(`MedDocs comments ${result.dryRun ? 'local dry-run' : 'Production sync'}: ${result.total} catalog entries, ${result.enabled} published articles. No comment data replaced.`);
    }).catch(() => { console.error('MedDocs comment sync failed. Check manifest, Production context, server-only key and migration.'); process.exitCode = 1; });
  }
}
