import type { StarlightRouteData } from '@astrojs/starlight/route-data';

export type SidebarBadge = 'new' | 'top' | 'soon' | 'planned' | 'popular';
type SidebarEntry = StarlightRouteData['sidebar'][number];

// Texte zentral halten; weitere Sprachen können hier ergänzt werden.
export const sidebarBadgeLabels: Record<string, Record<SidebarBadge, string>> = {
  de: { new: 'Neu', top: 'Top', soon: 'Bald', planned: 'Geplant', popular: 'Beliebt' },
  en: { new: 'New', top: 'Top', soon: 'Soon', planned: 'Planned', popular: 'Popular' },
};

type BadgeAssignment = (
  | { group: readonly string[]; href?: never }
  | { href: string; group?: never }
) & { badge: SidebarBadge };

// Hier Status zuweisen oder eine Zeile entfernen, um ihren Badge auszublenden.
// Gruppen: vollständiger Pfad der Sidebar-Labels; Links: genaue Ziel-URL.
export const sidebarBadges: readonly BadgeAssignment[] = [
  { group: ['EKG'], badge: 'planned' },
  { group: ['Echokardiographie'], badge: 'new' },
  { group: ['Sonographie'], badge: 'soon' },
  { group: ['Notfallmedizin'], badge: 'top' },
  { group: ['Diverses'], badge: 'popular' },
  // { href: '/meddocs/echokardiographie/', badge: 'new' },
];

/** Ergänzt native Starlight-Badges, ohne die geteilten Navigationsdaten zu verändern. */
export function withSidebarBadges(
  entries: SidebarEntry[],
  language = 'de',
  groupPath: readonly string[] = [],
): SidebarEntry[] {
  const labels = sidebarBadgeLabels[language.split('-')[0]] ?? sidebarBadgeLabels.de;
  return entries.map((entry) => {
    const path = [...groupPath, entry.label];
    const assignment = sidebarBadges.find((item) => entry.type === 'link'
      ? item.href === entry.href
      : item.group?.length === path.length && item.group.every((label, i) => label === path[i]));
    const badge = assignment ? {
      text: labels[assignment.badge],
      variant: 'default' as const,
      class: `mn-sidebar-badge mn-sidebar-badge--${assignment.badge}`,
    } : entry.badge;
    return entry.type === 'group'
      ? { ...entry, badge, entries: withSidebarBadges(entry.entries, language, path) }
      : { ...entry, badge };
  });
}
