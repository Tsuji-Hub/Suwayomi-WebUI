/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { useLingui } from '@lingui/react/macro';
import { useAppTitle } from '@/features/navigation-bar/hooks/useAppTitle.ts';
import { useIntersectionObserver } from '@/base/hooks/useIntersectionObserver.tsx';
import type { DiscoverSelection, DiscoverSort } from '@/features/tsuji/discover/discoverQuery.ts';
import {
    BROWSE_SORTS,
    buildDiscoverVariables,
    EMPTY_SELECTION,
    getIncludedTags,
    hasSelection,
    LANDING_SORTS,
    SERVER_SORTS,
} from '@/features/tsuji/discover/discoverQuery.ts';
import { useDiscoverFeed, useTagCatalog } from '@/features/tsuji/discover/useDiscoverFeed.ts';
import { TagPicker } from '@/features/tsuji/discover/components/TagPicker.tsx';
import type { RecFilters } from '@/features/tsuji/recs/filters.ts';
import { passesFilters } from '@/features/tsuji/recs/filters.ts';
import { rerankByIncludeTags } from '@/features/tsuji/recs/rank.ts';
import { REC_SORT_LABELS } from '@/features/tsuji/recs/Recs.constants.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { REC_CARD_WIDTH, RecCard, RecCardSkeleton } from '@/features/tsuji/recs/components/RecCard.tsx';
import { RecFilterBar } from '@/features/tsuji/recs/components/RecFilterBar.tsx';
import { RecPreviewDialog, useRecPreview } from '@/features/tsuji/recs/components/RecPreviewDialog.tsx';
import { useFindToRead, useLibraryIndex, useRecFilters } from '@/features/tsuji/recs/useRecsData.ts';
import { useSessionState } from '@/features/tsuji/services/useSessionState.ts';

/**
 * Stop auto-loading after this many consecutive pages that client filters leave (nearly) empty; the user continues
 * with "Load more". Protects the 30 req/min budget from paging a whole catalog in the background.
 */
const MAX_EMPTY_PAGE_STREAK = 3;
const MIN_VISIBLE_PER_PAGE = 5;
const SKELETON_KEYS = Array.from({ length: 12 }, (_, index) => `skeleton-${index}`);

const CardGrid = styled('div')(({ theme }) => ({
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${REC_CARD_WIDTH + 10}px, 1fr))`,
    gap: theme.spacing(2),
}));

const CardRow = styled('div')(({ theme }) => ({
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: `${REC_CARD_WIDTH}px`,
    gap: theme.spacing(1.5),
    overflowX: 'auto',
    paddingBottom: theme.spacing(1),
}));

const getTrailingSparseStreak = (counts: number[]): number => {
    const lastFull = counts.reduce((last, count, index) => (count >= MIN_VISIBLE_PER_PAGE ? index : last), -1);
    return counts.length - 1 - lastFull;
};

const DiscoverBrowse = () => {
    const { t } = useLingui();
    const [selection, setSelection] = useSessionState<DiscoverSelection>('discoverSelection', EMPTY_SELECTION);
    const [sortChoice, setSortChoice] = useSessionState<DiscoverSort | null>('discoverSort', null);
    const [storedFilters, setFilters] = useRecFilters();
    const libraryIndex = useLibraryIndex();
    const findToRead = useFindToRead();
    const preview = useRecPreview();
    const { catalog, isError: isCatalogError, retry: retryCatalog } = useTagCatalog();

    // Hidden gems is a Similar-only mode; don't let it silently filter Discover.
    const filters: RecFilters = useMemo(() => ({ ...storedFilters, hiddenGems: false }), [storedFilters]);

    const isBrowsing = hasSelection(selection);
    const sortOptions = isBrowsing ? BROWSE_SORTS : LANDING_SORTS;
    const sort: DiscoverSort = sortChoice && sortOptions.includes(sortChoice) ? sortChoice : sortOptions[0];
    const includedTags = useMemo(() => getIncludedTags(selection), [selection]);
    const variables = useMemo(() => buildDiscoverVariables(selection, filters), [selection, filters]);

    const feed = useDiscoverFeed({ variables, serverSort: SERVER_SORTS[sort] });
    const isTrendingLanding = !isBrowsing && sort === 'TRENDING';
    const popular = useDiscoverFeed({ variables, serverSort: SERVER_SORTS.POPULARITY, isEnabled: isTrendingLanding });
    const hasFellBack = !!feed.serverSort && feed.serverSort !== SERVER_SORTS[sort];

    const isVisible = useCallback(
        (media: RecMedia) => !!libraryIndex && passesFilters(media, filters, libraryIndex, { applyTagFilters: false }),
        [filters, libraryIndex],
    );

    const { items, emptyStreak } = useMemo(() => {
        const seen = new Set<number>();
        const visiblePages = feed.pages.map((page) =>
            (sort === 'BEST' && includedTags.length ? rerankByIncludeTags(page, includedTags) : page).filter(
                (media) => {
                    if (seen.has(media.id) || !isVisible(media)) {
                        return false;
                    }
                    seen.add(media.id);
                    return true;
                },
            ),
        );

        return {
            items: visiblePages.flat(),
            emptyStreak: getTrailingSparseStreak(visiblePages.map((page) => page.length)),
        };
    }, [feed.pages, sort, includedTags, isVisible]);

    const popularItems = useMemo(() => (popular.pages[0] ?? []).filter(isVisible), [popular.pages, isVisible]);

    const canAutoLoad =
        !!libraryIndex && feed.hasNextPage && !feed.isLoading && !feed.isError && emptyStreak < MAX_EMPTY_PAGE_STREAK;

    const sentinelRef = useRef<HTMLDivElement>(null);
    const [isSentinelVisible, setIsSentinelVisible] = useState(false);
    const handleIntersection = useCallback<IntersectionObserverCallback>(([entry]) => {
        setIsSentinelVisible(entry.isIntersecting);
    }, []);
    useIntersectionObserver(sentinelRef, handleIntersection, { rootMargin: '600px' });

    useEffect(() => {
        if (isSentinelVisible && canAutoLoad) {
            feed.loadMore();
        }
    }, [isSentinelVisible, canAutoLoad, feed.loadMore, feed.pages.length]);

    const isInitialLoading = !libraryIndex || (feed.isLoading && !feed.pages.length);

    return (
        <Stack sx={{ gap: 2 }}>
            {catalog && (
                <TagPicker
                    catalog={catalog}
                    selection={selection}
                    onChange={setSelection}
                    showAdult={filters.showAdult}
                />
            )}
            {isCatalogError && (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t`Couldn't load the tag list.`}
                    </Typography>
                    <Button size="small" onClick={retryCatalog}>
                        {t`Retry`}
                    </Button>
                </Stack>
            )}
            <RecFilterBar
                filters={storedFilters}
                onFiltersChange={setFilters}
                sort={sort}
                sortOptions={sortOptions.map((value) => ({
                    value,
                    label: value === 'TRENDING' ? t`Trending` : t(REC_SORT_LABELS[value]),
                }))}
                onSortChange={(value) => setSortChoice(value as DiscoverSort)}
            />
            {hasFellBack && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t`AniList isn't serving this sort right now; showing the closest available order.`}
                </Typography>
            )}
            {isTrendingLanding && !hasFellBack && !!popularItems.length && (
                <Stack sx={{ gap: 1 }}>
                    <Typography variant="h6" component="h2">
                        {t`Popular`}
                    </Typography>
                    <CardRow>
                        {popularItems.map((media) => (
                            <RecCard key={media.id} media={media} onOpen={findToRead} onPreview={preview.show} />
                        ))}
                    </CardRow>
                </Stack>
            )}
            {isTrendingLanding && (
                <Typography variant="h6" component="h2">
                    {hasFellBack ? t`Popular` : t`Trending`}
                </Typography>
            )}
            {isInitialLoading && (
                <CardGrid aria-busy>
                    {SKELETON_KEYS.map((key) => (
                        <RecCardSkeleton key={key} />
                    ))}
                </CardGrid>
            )}
            {!isInitialLoading && !!items.length && (
                <CardGrid>
                    {items.map((media) => (
                        <RecCard key={media.id} media={media} onOpen={findToRead} onPreview={preview.show} />
                    ))}
                </CardGrid>
            )}
            {!isInitialLoading && !items.length && !feed.hasNextPage && !feed.isError && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`No titles match these tags and filters.`}
                </Typography>
            )}
            {feed.isError && (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t`Couldn't load more titles.`}
                    </Typography>
                    <Button size="small" onClick={feed.retry}>
                        {t`Retry`}
                    </Button>
                </Stack>
            )}
            {!feed.isError && feed.hasNextPage && emptyStreak >= MAX_EMPTY_PAGE_STREAK && (
                <Stack sx={{ alignItems: 'center', gap: 1 }}>
                    {!items.length && (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {t`Nothing matched your filters in the titles loaded so far.`}
                        </Typography>
                    )}
                    <Button onClick={feed.loadMore} disabled={feed.isLoading}>
                        {t`Load more`}
                    </Button>
                </Stack>
            )}
            {feed.isLoading && !!feed.pages.length && (
                <CardGrid aria-busy>
                    {SKELETON_KEYS.slice(0, 6).map((key) => (
                        <RecCardSkeleton key={key} />
                    ))}
                </CardGrid>
            )}
            <div ref={sentinelRef} />
            <RecPreviewDialog
                media={preview.media}
                isOpen={preview.isOpen}
                onClose={preview.close}
                onFind={findToRead}
            />
        </Stack>
    );
};

export const Discover = () => {
    const { t } = useLingui();
    const [tab, setTab] = useSessionState<'discover' | 'forYou'>('discoverTab', 'discover');

    useAppTitle(t`Discover`);

    return (
        <Stack sx={{ p: 1, gap: 2 }}>
            <Tabs value={tab} onChange={(_, value: 'discover' | 'forYou') => setTab(value)}>
                <Tab value="discover" label={t`Discover`} />
                <Tab value="forYou" label={t`For You`} />
            </Tabs>
            {tab === 'discover' ? (
                <DiscoverBrowse />
            ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`For You arrives in a later update.`}
                </Typography>
            )}
        </Stack>
    );
};
