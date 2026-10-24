import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, render } from 'astro:content';
import { extractArticlePreview, isPreviewArticle } from '../../lib/meddocs/link-previews/extract';
import type { ArticlePreview } from '../../lib/meddocs/link-previews/model';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const articles = await getCollection('docs', isPreviewArticle);
  return Promise.all(articles.map(async (entry) => {
    const { headings } = await render(entry);
    return { params: { path: entry.id }, props: { preview: extractArticlePreview(entry, headings) } };
  }));
};

export const GET: APIRoute = ({ props }) => new Response(JSON.stringify(props.preview as ArticlePreview), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' },
});
