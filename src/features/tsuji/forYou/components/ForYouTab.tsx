/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo } from 'react';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import {
    getSeedRow,
    getTopSeeds,
    passesQualityFloor,
    QUALITY_MIN_POPULARITY,
    rankForYou,
} from '@/features/tsuji/forYou/forYouCandidates.ts';
import { useFamilyRow } from '@/features/tsuji/forYou/useFamilyRow.ts';
import { readShownIds, SHOWN_PER_WEEK, writeShownIds } from '@/features/tsuji/forYou/forYouHistory.ts';
import { useForYou } from '@/features/tsuji/forYou/useForYou.ts';
import { getIsoWeekKey } from '@/features/tsuji/forYou/weeklyRotation.ts';
import type { RecFilters } from '@/features/tsuji/recs/filters.ts';
import { isInLibrary, passesFilters, REC_SORTS, sortRecs } from '@/features/tsuji/recs/filters.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { REC_SORT_LABELS } from '@/features/tsuji/recs/Recs.constants.ts';
import { REC_CARD_WIDTH, RecCard, RecCardSkeleton } from '@/features/tsuji/recs/components/RecCard.tsx';
import { RecFilterBar } from '@/features/tsuji/recs/components/RecFilterBar.tsx';
import { RecPreviewDialog, useRecPreview } from '@/features/tsuji/recs/components/RecPreviewDialog.tsx';
import { useFindToRead, useLibraryIndex, useRecFilters } from '@/features/tsuji/recs/useRecsData.ts';
import { MyListNotice } from '@/features/tsuji/seen/components/MyListNotice.tsx';
import { useSeen, useSeenActions } from '@/features/tsuji/seen/useSeen.tsx';
import { ScrollRow } from '@/features/tsuji/recs/components/ScrollRow.tsx';
import { AniListFallbackNote } from '@/features/tsuji/recs/components/AniListFallbackNote.tsx';

const SKELETON_KEYS = Array.from({ length: 12 }, (_, index) => `skeleton-${index}`);
const TOP_PICKS = 24;
const BEST_MATCHES = 30;
const ROW_LENGTH = 12;
const FAMILY_ROW_LENGTH = 20;
const TASTE_CHIPS = 8;

const CardGrid = styled('div')(({ theme }) => ({
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${REC_CARD_WIDTH + 10}px, 1fr))`,
    gap: theme.spacing(2),
}));

const getStorage = (): Storage | null => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

/**
 * For You: Best matches from the strongest liked titles (brief #13), then this week's picks from the user's AniList
 * taste and a row per seed title, without what Best matches already shows.
 */
export const ForYouTab = () => {
    const { t, i18n } = useLingui();
    const { state, userName, retry, refresh } = useForYou();
    const [storedFilters, setFilters] = useRecFilters();
    const libraryIndex = useLibraryIndex();
    const findToRead = useFindToRead();
    const preview = useRecPreview();
    const seen = useSeen();
    const markSeen = useSeenActions();

    // Hidden gems and tag filters are Similar-only controls; don't let them silently filter For You.
    const filters: RecFilters = useMemo(() => ({ ...storedFilters, hiddenGems: false }), [storedFilters]);
    const data = state.status === 'ready' ? state.data : null;

    const lastWeekIds = useMemo(() => {
        const storage = getStorage();
        return data && storage ? readShownIds(storage, userName, getIsoWeekKey(new Date(data.weekStart - DAY_MS))) : [];
    }, [data, userName]);

    const visible = useMemo(() => {
        if (!data || !libraryIndex) {
            return [];
        }
        return rankForYou(data.profileTags, data.candidates, lastWeekIds).filter((item) =>
            passesFilters(item, filters, libraryIndex, { applyTagFilters: false, getSeenState: seen.getSeenState }),
        );
    }, [data, lastWeekIds, filters, libraryIndex, seen.getSeenState]);

    // Best matches (brief #13): the strongest liked titles' recommendations, the same hide rules and filters, and
    // never a library title, started or not (a Plan to Read title is no discovery), even with that filter off.
    const bestMatches = useMemo(() => {
        if (!data || !libraryIndex) {
            return [];
        }
        return (data.bestMatches ?? [])
            .filter(
                (item) =>
                    passesQualityFloor(item) &&
                    !isInLibrary(item, libraryIndex) &&
                    passesFilters(item, filters, libraryIndex, {
                        applyTagFilters: false,
                        getSeenState: seen.getSeenState,
                    }),
            )
            .slice(0, BEST_MATCHES);
    }, [data, filters, libraryIndex, seen.getSeenState]);
    const bestIds = useMemo(() => new Set(bestMatches.map(({ id }) => id)), [bestMatches]);

    // The weekly picks stay for variety, without what Best matches already shows.
    const topPicks = useMemo(
        () =>
            sortRecs(
                visible.filter((item) => !bestIds.has(item.id) && passesQualityFloor(item)),
                filters,
            ).slice(0, TOP_PICKS),
        [visible, filters, bestIds],
    );
    // "More <Family>" (brief #14): MangaBaka's take on a family the liked titles share, same rules as Best matches,
    // without what Best matches and Top picks show.
    const isFamilyCardVisible = useCallback(
        (item: RecMedia) =>
            !!libraryIndex &&
            !bestIds.has(item.id) &&
            !topPicks.some(({ id }) => id === item.id) &&
            (item.averageScore !== null || (item.popularity ?? 0) >= QUALITY_MIN_POPULARITY) &&
            !isInLibrary(item, libraryIndex) &&
            passesFilters(item, filters, libraryIndex, { applyTagFilters: false, getSeenState: seen.getSeenState }),
        [libraryIndex, bestIds, topPicks, filters, seen.getSeenState],
    );
    const familyRow = useFamilyRow(userName, data, !!data && !!libraryIndex && seen.isSettled, isFamilyCardVisible);
    const familyItems = useMemo(
        () => (familyRow?.family ? familyRow.items.filter(isFamilyCardVisible).slice(0, FAMILY_ROW_LENGTH) : []),
        [familyRow, isFamilyCardVisible],
    );
    const familyLabel = familyRow?.family?.label ?? '';

    const seedRows = useMemo(
        () =>
            (data?.seeds ?? [])
                .map((seed) => ({
                    seed,
                    items: getSeedRow(
                        visible.filter((item) => !bestIds.has(item.id)),
                        seed.mediaId,
                    ).slice(0, ROW_LENGTH),
                }))
                .filter(({ items }) => items.length > 0),
        [data, visible, bestIds],
    );

    const areCardsReady = !!libraryIndex && seen.isSettled;
    const isLoading = state.status === 'loading' || (state.status === 'ready' && !areCardsReady);

    // Remember this week's head (best match order) so next week's ranking moves it down.
    const shownKey = data && areCardsReady ? `${data.weekKey}:${filters.sort}` : null;
    useEffect(() => {
        const storage = getStorage();
        if (!data || !areCardsReady || !storage || filters.sort !== 'BEST') {
            return;
        }
        writeShownIds(
            storage,
            userName,
            data.weekKey,
            topPicks.slice(0, SHOWN_PER_WEEK).map(({ id }) => id),
        );
    }, [shownKey, topPicks.length]);

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

    const body = (() => {
        if (isLoading) {
            return (
                <CardGrid aria-busy>
                    {SKELETON_KEYS.map((key) => (
                        <RecCardSkeleton key={key} />
                    ))}
                </CardGrid>
            );
        }

        if (state.status === 'error') {
            return (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t`Couldn't build your picks: AniList didn't answer in time.`}
                    </Typography>
                    <Button size="small" onClick={retry}>
                        {t`Retry`}
                    </Button>
                </Stack>
            );
        }

        if (state.status === 'empty') {
            return (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {state.entryCount
                        ? t`Not enough to go on yet: ${userName}'s AniList list has no titles liked enough to build picks from. Rate or finish a few, then refresh.`
                        : t`${userName}'s AniList list has no manga being read or finished. For You builds on that list; the username is in Discover settings.`}
                </Typography>
            );
        }

        if (!topPicks.length && !bestMatches.length) {
            return (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`Nothing left after filters.`}
                </Typography>
            );
        }

        return (
            <Stack sx={{ gap: 3 }}>
                {!!bestMatches.length && (
                    <Stack sx={{ gap: 1 }}>
                        <Stack>
                            <Typography variant="h6" component="h2">
                                {t`Best matches`}
                            </Typography>
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                {t`Best matches from all ${plural(data!.entryCount, { one: '# title', other: '# titles' })} you read.`}
                            </Typography>
                        </Stack>
                        <ScrollRow label={t`Best matches`}>
                            {bestMatches.map((media) => {
                                const reasons = getTopSeeds(media, data!.bestSeeds)
                                    .map(({ title }) => title)
                                    .join(', ');
                                return (
                                    <Stack key={media.id} sx={{ width: REC_CARD_WIDTH, flex: '0 0 auto', gap: 0.5 }}>
                                        {renderCard(media)}
                                        {!!reasons && (
                                            <Typography
                                                variant="caption"
                                                title={t`Because you read ${reasons}`}
                                                sx={{
                                                    color: 'text.secondary',
                                                    display: '-webkit-box',
                                                    WebkitLineClamp: 2,
                                                    WebkitBoxOrient: 'vertical',
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                {t`Because you read ${reasons}`}
                                            </Typography>
                                        )}
                                    </Stack>
                                );
                            })}
                        </ScrollRow>
                    </Stack>
                )}
                {!!topPicks.length && (
                    <Stack sx={{ gap: 1 }}>
                        <Typography variant="h6" component="h2">
                            {t`Top picks`}
                        </Typography>
                        <CardGrid>{topPicks.map(renderCard)}</CardGrid>
                    </Stack>
                )}
                {!!familyItems.length && (
                    <Stack sx={{ gap: 1 }}>
                        <Typography variant="h6" component="h2">
                            {t`More ${familyLabel}`}
                        </Typography>
                        <ScrollRow label={t`More ${familyLabel}`}>{familyItems.map(renderCard)}</ScrollRow>
                    </Stack>
                )}
                {seedRows.map(({ seed, items }) => (
                    <Stack key={seed.mediaId} sx={{ gap: 1 }}>
                        <Typography variant="h6" component="h2">
                            {t`Because you read ${seed.title}`}
                        </Typography>
                        <ScrollRow label={t`Because you read ${seed.title}`}>{items.map(renderCard)}</ScrollRow>
                    </Stack>
                ))}
            </Stack>
        );
    })();

    const fallbackListDate = data?.fallback
        ? new Date(data.fallback.listFetchedAt).toLocaleDateString(i18n.locale, { month: 'short', day: 'numeric' })
        : null;
    const weekStartLabel = data
        ? new Date(data.weekStart).toLocaleDateString(i18n.locale, { month: 'short', day: 'numeric' })
        : null;

    return (
        <Stack sx={{ gap: 2 }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Stack sx={{ gap: 0.5, flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {data
                            ? t`Picks for the week of ${weekStartLabel}, from ${plural(data.entryCount, { one: '# title', other: '# titles' })} on ${userName}'s AniList. New picks every Monday.`
                            : t`Picks from ${userName}'s AniList. New picks every Monday.`}
                    </Typography>
                    {!!data?.profileTags.length && (
                        <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }} aria-label={t`Your taste`}>
                            {data.profileTags.slice(0, TASTE_CHIPS).map(({ name }) => (
                                <Chip key={name} label={name} size="small" variant="outlined" />
                            ))}
                        </Stack>
                    )}
                </Stack>
                <Button size="small" onClick={refresh} disabled={state.status === 'loading'}>
                    {t`Refresh`}
                </Button>
            </Stack>
            <RecFilterBar
                filters={storedFilters}
                onFiltersChange={setFilters}
                sort={filters.sort}
                sortOptions={REC_SORTS.map((value) => ({ value, label: t(REC_SORT_LABELS[value]) }))}
                onSortChange={(value) => setFilters({ ...storedFilters, sort: value as RecFilters['sort'] })}
            />
            {seen.myList.isUnavailable && (
                <MyListNotice userName={seen.myList.userName} onRetry={seen.myList.refresh} />
            )}
            {!!fallbackListDate && (
                <AniListFallbackNote
                    message={t`AniList is down: picks from Comick, based on your list from ${fallbackListDate}.`}
                />
            )}
            {data?.isPartial && !data.fallback && !isLoading && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t`Part of AniList's answer is missing this time, so the picks are thinner. Refresh to try again.`}
                </Typography>
            )}
            {body}
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
