/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import SettingsIcon from '@mui/icons-material/Settings';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
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
import { DegradedMemory } from '@/features/tsuji/discover/degradedMemory.ts';
import type { LandingSource } from '@/features/tsuji/discover/landing.ts';
import { pickLandingSource } from '@/features/tsuji/discover/landing.ts';
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
import { MyListNotice } from '@/features/tsuji/seen/components/MyListNotice.tsx';
import { TsujiSettingsDialog } from '@/features/tsuji/seen/components/TsujiSettingsDialog.tsx';
import { useSeen, useSeenActions } from '@/features/tsuji/seen/useSeen.tsx';
import { useSessionState } from '@/features/tsuji/services/useSessionState.ts';

/**
 * Stop auto-loading after this many consecutive pages that client filters leave (nearly) empty; the user continues
 * with "Load more". Protects the 30 req/min budget from paging a whole catalog in the background.
 */
const MAX_EMPTY_PAGE_STREAK = 3;
const MIN_VISIBLE_PER_PAGE = 5;
/** Past this, Trending arriving late no longer replaces the Popular grid under the user. */
const SCROLL_LOCK_PX = 120;
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

const Skeletons = ({ count }: { count: number }) => (
    <CardGrid aria-busy>
        {SKELETON_KEYS.slice(0, count).map((key) => (
            <RecCardSkeleton key={key} />
        ))}
    </CardGrid>
);

const DiscoverBrowse = () => {
    const { t } = useLingui();
    const [selection, setSelection] = useSessionState<DiscoverSelection>('discoverSelection', EMPTY_SELECTION);
    const [sortChoice, setSortChoice] = useSessionState<DiscoverSort | null>('discoverSort', null);
    const [storedFilters, setFilters] = useRecFilters();
    const libraryIndex = useLibraryIndex();
    const findToRead = useFindToRead();
    const preview = useRecPreview();
    const seen = useSeen();
    const markSeen = useSeenActions();

    const [isPickerExpanded, setIsPickerExpanded] = useState(false);
    const catalog = useTagCatalog(isPickerExpanded);

    // Hidden gems is a Similar-only mode; don't let it silently filter Discover.
    const filters: RecFilters = useMemo(() => ({ ...storedFilters, hiddenGems: false }), [storedFilters]);

    const isBrowsing = hasSelection(selection);
    const sortOptions = isBrowsing ? BROWSE_SORTS : LANDING_SORTS;
    const sort: DiscoverSort = sortChoice && sortOptions.includes(sortChoice) ? sortChoice : sortOptions[0];
    const includedTags = useMemo(() => getIncludedTags(selection), [selection]);
    const variables = useMemo(() => buildDiscoverVariables(selection, filters), [selection, filters]);

    // Landing: Trending and Popular in parallel; whichever has cards first fills the grid (see pickLandingSource).
    const isLanding = !isBrowsing && sort === 'TRENDING';
    const [isTrendingKnownBroken] = useState(() => DegradedMemory.isSortFailed(SERVER_SORTS.TRENDING));
    const trending = useDiscoverFeed({
        variables,
        serverSort: SERVER_SORTS.TRENDING,
        isEnabled: isLanding && !isTrendingKnownBroken,
        allowSortFallback: false,
    });
    const popular = useDiscoverFeed({ variables, serverSort: SERVER_SORTS.POPULARITY, isEnabled: isLanding });
    const browse = useDiscoverFeed({ variables, serverSort: SERVER_SORTS[sort], isEnabled: !isLanding });

    const [landingSource, setLandingSource] = useState<LandingSource>('loading');
    const variablesKey = JSON.stringify(variables);
    useEffect(() => setLandingSource('loading'), [variablesKey]);
    useEffect(() => {
        if (!isLanding) {
            return;
        }

        setLandingSource((current) =>
            pickLandingSource({
                current,
                trending: trending.phase,
                popular: popular.phase,
                hasScrolled: window.scrollY > SCROLL_LOCK_PX,
                hasPagedPopular: popular.pages.length > 1,
            }),
        );
    }, [isLanding, trending.phase, popular.phase, popular.pages.length]);

    const isTrendingOut = trending.phase === 'off' || trending.phase === 'empty' || trending.phase === 'failed';
    useEffect(() => {
        // Trending came back empty or timed out while Popular works: skip it for the next 30 minutes.
        if (isLanding && popular.phase === 'ready' && (trending.phase === 'empty' || trending.phase === 'failed')) {
            DegradedMemory.rememberSortFailed(SERVER_SORTS.TRENDING);
        }
    }, [isLanding, popular.phase, trending.phase]);

    const landingFeed = landingSource === 'trending' ? trending : popular;
    const feed = isLanding ? landingFeed : browse;
    const hasFellBack = isLanding
        ? landingSource === 'popular' && isTrendingOut
        : !!browse.serverSort && browse.serverSort !== SERVER_SORTS[sort];

    const isVisible = useCallback(
        (media: RecMedia) =>
            !!libraryIndex &&
            passesFilters(media, filters, libraryIndex, {
                applyTagFilters: false,
                getSeenState: seen.getSeenState,
            }),
        [filters, libraryIndex, seen.getSeenState],
    );

    const { items, emptyStreak } = useMemo(() => {
        const seenIds = new Set<number>();
        const visiblePages = feed.pages.map((page) =>
            (sort === 'BEST' && includedTags.length ? rerankByIncludeTags(page, includedTags) : page).filter(
                (media) => {
                    if (seenIds.has(media.id) || !isVisible(media)) {
                        return false;
                    }
                    seenIds.add(media.id);
                    return true;
                },
            ),
        );

        return {
            items: visiblePages.flat(),
            emptyStreak: getTrailingSparseStreak(visiblePages.map((page) => page.length)),
        };
    }, [feed.pages, sort, includedTags, isVisible]);

    const popularRow = useMemo(
        () => (isLanding && landingSource === 'trending' ? (popular.pages[0] ?? []).filter(isVisible) : []),
        [isLanding, landingSource, popular.pages, isVisible],
    );

    // Cards wait for the library index and the AniList list (capped by its 4 s timeout), so hidden titles don't
    // flash in and vanish; tabs, the tag picker and filters are usable meanwhile.
    const areCardsReady = !!libraryIndex && seen.isSettled;
    const isInitialLoading =
        !areCardsReady || (isLanding && landingSource === 'loading') || (feed.isLoading && !feed.pages.length);
    const canAutoLoad =
        areCardsReady && feed.hasNextPage && !feed.isLoading && !feed.isError && emptyStreak < MAX_EMPTY_PAGE_STREAK;

    const sentinelRef = useRef<HTMLDivElement>(null);
    const [isSentinelVisible, setIsSentinelVisible] = useState(false);
    const handleIntersection = useCallback<IntersectionObserverCallback>(([entry]) => {
        setIsSentinelVisible(entry.isIntersecting);
    }, []);
    useIntersectionObserver(sentinelRef, handleIntersection, { rootMargin: '600px' });

    useEffect(() => {
        if (isSentinelVisible && canAutoLoad && !isInitialLoading) {
            feed.loadMore();
        }
    }, [isSentinelVisible, canAutoLoad, isInitialLoading, feed.loadMore, feed.pages.length]);

    const renderCard = (media: RecMedia) => (
        <RecCard
            key={media.id}
            media={media}
            onOpen={findToRead}
            onPreview={preview.show}
            seenState={seen.getSeenState(media.id)}
            onMark={markSeen}
        />
    );

    const gridHeading = landingSource === 'trending' ? t`Trending` : t`Popular`;

    return (
        <Stack sx={{ gap: 2 }}>
            <TagPicker
                catalog={catalog.catalog}
                isCatalogError={catalog.isError}
                onRetryCatalog={catalog.retry}
                isExpanded={isPickerExpanded}
                onExpandedChange={setIsPickerExpanded}
                selection={selection}
                onChange={setSelection}
                showAdult={filters.showAdult}
            />
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
            {seen.myList.isUnavailable && (
                <MyListNotice userName={seen.myList.userName} onRetry={seen.myList.refresh} />
            )}
            {hasFellBack && !isInitialLoading && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {isLanding
                        ? t`Trending isn't available from AniList right now; showing Popular.`
                        : t`AniList isn't serving this sort right now; showing the closest available order.`}
                </Typography>
            )}
            {!isInitialLoading && !!popularRow.length && (
                <Stack sx={{ gap: 1 }}>
                    <Typography variant="h6" component="h2">
                        {t`Popular`}
                    </Typography>
                    <CardRow>{popularRow.map(renderCard)}</CardRow>
                </Stack>
            )}
            {isLanding && !isInitialLoading && (
                <Typography variant="h6" component="h2">
                    {gridHeading}
                </Typography>
            )}
            {isInitialLoading && <Skeletons count={12} />}
            {!isInitialLoading && !!items.length && <CardGrid>{items.map(renderCard)}</CardGrid>}
            {!isInitialLoading && !items.length && !feed.hasNextPage && !feed.isError && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`No titles match these tags and filters.`}
                </Typography>
            )}
            {!isInitialLoading && feed.isError && (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {feed.pages.length ? t`Couldn't load more titles.` : t`AniList didn't answer in time.`}
                    </Typography>
                    <Button size="small" onClick={feed.retry}>
                        {t`Retry`}
                    </Button>
                </Stack>
            )}
            {!isInitialLoading && !feed.isError && feed.hasNextPage && emptyStreak >= MAX_EMPTY_PAGE_STREAK && (
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
            {!isInitialLoading && feed.isLoading && <Skeletons count={6} />}
            <div ref={sentinelRef} />
            <RecPreviewDialog
                media={preview.media}
                isOpen={preview.isOpen}
                onClose={preview.close}
                onFind={findToRead}
                getSeenState={seen.getSeenState}
                onMark={markSeen}
            />
        </Stack>
    );
};

export const Discover = () => {
    const { t } = useLingui();
    const [tab, setTab] = useSessionState<'discover' | 'forYou'>('discoverTab', 'discover');
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    useAppTitle(t`Discover`);

    return (
        <Stack sx={{ p: 1, gap: 2 }}>
            <Stack direction="row" sx={{ alignItems: 'center' }}>
                <Tabs value={tab} onChange={(_, value: 'discover' | 'forYou') => setTab(value)}>
                    <Tab value="discover" label={t`Discover`} />
                    <Tab value="forYou" label={t`For You`} />
                </Tabs>
                <CustomTooltip title={t`Discover settings`}>
                    <IconButton
                        aria-label={t`Discover settings`}
                        onClick={() => setIsSettingsOpen(true)}
                        sx={{ ml: 'auto' }}
                    >
                        <SettingsIcon />
                    </IconButton>
                </CustomTooltip>
            </Stack>
            {tab === 'discover' ? (
                <DiscoverBrowse />
            ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`For You arrives in a later update.`}
                </Typography>
            )}
            <TsujiSettingsDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        </Stack>
    );
};
