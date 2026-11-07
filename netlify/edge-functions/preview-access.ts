import { handleAccess, type EdgeContext } from '../lib/preview-access/handler.ts';

export default (request: Request, context: EdgeContext) => handleAccess(request, context);

// Literal configuration is extracted by Netlify. No cache opt-in, no asset exclusions.
export const config = {
  path: '/*',
  excludedPath: ['/_preview-access/login', '/_preview-access/login/'],
  onError: 'fail',
};
