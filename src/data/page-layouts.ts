export const pageLayouts = ['default', 'legal'] as const;

export type PageLayout = (typeof pageLayouts)[number];

type PageLayoutOptions = {
	showSidebar: boolean;
	reserveLeftRail: boolean;
};

export const pageLayoutOptions = {
	default: { showSidebar: true, reserveLeftRail: true },
	legal: { showSidebar: false, reserveLeftRail: true },
} as const satisfies Record<PageLayout, PageLayoutOptions>;

export function resolvePageLayout(pageLayout?: PageLayout): PageLayout {
	return pageLayout ?? 'default';
}
