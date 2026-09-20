export const pageLayouts = ['default', 'legal', 'hub'] as const;

export type PageLayout = (typeof pageLayouts)[number];

type PageLayoutOptions = {
	showSidebar: boolean;
	showToc: boolean;
	reserveLeftRail: boolean;
};

export const pageLayoutOptions = {
	default: { showSidebar: true, showToc: true, reserveLeftRail: true },
	legal: { showSidebar: false, showToc: true, reserveLeftRail: true },
	hub: { showSidebar: true, showToc: false, reserveLeftRail: true },
} as const satisfies Record<PageLayout, PageLayoutOptions>;

export function resolvePageLayout(pageLayout?: PageLayout): PageLayout {
	return pageLayout ?? 'default';
}
