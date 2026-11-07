import { handleLogin, type EdgeContext } from '../lib/preview-access/handler.ts';

export default (request: Request, context: EdgeContext) => handleLogin(request, context);

// Only login attempts are counted, never Pagefind, scripts, images or styles.
export const config = {
  path: ['/_preview-access/login', '/_preview-access/login/'],
  onError: 'fail',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip'], action: 'rate_limit' },
};
