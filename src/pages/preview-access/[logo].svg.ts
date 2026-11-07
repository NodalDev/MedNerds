import light from '../../assets/Logos/MedNerds - horizontal - hell.svg?raw';
import dark from '../../assets/Logos/MedNerds - horizontal - dunkel.svg?raw';
import type { APIRoute } from 'astro';

export const prerender = true;
export function getStaticPaths() {
  return [ { params: { logo: 'logo-light' }, props: { svg: light } },
    { params: { logo: 'logo-dark' }, props: { svg: dark } } ];
}
export const GET: APIRoute = ({ props }) => new Response(props.svg, { headers: { 'Content-Type': 'image/svg+xml' } });
