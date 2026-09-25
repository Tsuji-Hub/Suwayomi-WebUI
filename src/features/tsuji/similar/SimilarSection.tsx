/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useMemo } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import type { RecSort } from '@/features/tsuji/recs/filters.ts';
import { getTagOptions, passesFilters, REC_SORTS, sortRecs } from '@/features/tsuji/recs/filters.ts';
import { rankCandidates } from '@/features/tsuji/recs/rank.ts';
import { REC_SORT_LABELS } from '@/features/tsuji/recs/Recs.constants.ts';
import { REC_CARD_WIDTH, RecCard, RecCardSkeleton } from '@/features/tsuji/recs/components/RecCard.tsx';
import { RecFilterBar } from '@/features/tsuji/recs/components/RecFilterBar.tsx';
import { RecPreviewDialog, useRecPreview } from '@/features/tsuji/recs/components/RecPreviewDialog.tsx';
import { useFindToRead, useLibraryIndex, useRecFilters } from '@/features/tsuji/recs/useRecsData.ts';
import type { SimilarManga } from '@/features/tsuji/similar/useSimilarRecs.ts';
import { useSimilarRecs } from '@/features/tsuji/similar/useSimilarRecs.ts';
import { useSeen, useSeenActions } from '@/features/tsuji/seen/useSeen.tsx';
import { MyListNotice } from '@/features/tsuji/seen/components/MyListNotice.tsx';

const SKELETON_KEYS = Array.from({ length: 8 }, (_, index) => `skeleton-${index}`);

/** One horizontally scrolling row, so the section never pushes the chapter list far down. */
const CardRow = styled('div')(({ theme }) => ({
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: `${REC_CARD_WIDTH}px`,
    gap: theme.spacing(1.5),
    overflowX: 'auto',
    paddingBottom: theme.spacing(1),
    scrollSnapType: 'x proximity',
    '& > *': { scrollSnapAlign: 'start' },
}));

export const SimilarSection = ({ manga }: { manga: SimilarManga }) => {
    const { t } = useLingui();
    const { state, retry, refresh } = useSimilarRecs(manga);
    const [filters, setFilters] = useRecFilters();
    const libraryIndex = useLibraryIndex();
    const findToRead = useFindToRead();
    const preview = useRecPreview();
    const seen = useSeen();
    const markSeen = useSeenActions();

    const data = state.status === 'ready' ? state.data : null;
    const ranked = useMemo(() => (data ? rankCandidates(data.seedTags, data.candidates) : []), [data]);
    const visible = useMemo(
        () =>
            libraryIndex
                ? sortRecs(
                      ranked.filter((item) =>
                          passesFilters(item, filters, libraryIndex, { getSeenState: seen.getSeenState }),
                      ),
                      filters,
                  )
                : [],
        [ranked, filters, libraryIndex, seen.getSeenState],
    );
    const tagOptions = useMemo(
        () => getTagOptions(data?.candidates ?? [], filters.showAdult),
        [data, filters.showAdult],
    );
    const sortOptions = REC_SORTS.map((value) => ({ value, label: t(REC_SORT_LABELS[value]) }));

    // Cards wait for the library index and the AniList list (capped by its 4 s timeout), so they don't vanish after
    // rendering; the header and filters are usable meanwhile.
    const isLoading = state.status === 'loading' || (state.status === 'ready' && (!libraryIndex || !seen.isSettled));
    const sourceLabel = data?.sources.includes('mal') ? t`AniList + MAL` : t`AniList`;

    const body = (() => {
        if (isLoading) {
            return (
                <CardRow aria-busy>
                    {SKELETON_KEYS.map((key) => (
                        <RecCardSkeleton key={key} />
                    ))}
                </CardRow>
            );
        }

        if (state.status === 'no-match') {
            return (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t`No AniList match for this series.`}
                    </Typography>
                    <Button size="small" onClick={refresh}>
                        {t`Try again`}
                    </Button>
                </Stack>
            );
        }

        if (state.status === 'error') {
            return (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t`Couldn't load recommendations.`}
                    </Typography>
                    <Button size="small" onClick={retry}>
                        {t`Retry`}
                    </Button>
                </Stack>
            );
        }

        if (!visible.length) {
            return (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`Nothing left after filters.`}
                </Typography>
            );
        }

        return (
            <CardRow>
                {visible.map((item) => (
                    <RecCard
                        key={item.id}
                        media={item}
                        agreement={item.agreement}
                        onOpen={findToRead}
                        onPreview={preview.show}
                        seenState={seen.getSeenState(item.id)}
                        onMark={markSeen}
                    />
                ))}
            </CardRow>
        );
    })();

    return (
        <Stack component="section" sx={{ gap: 1 }} aria-label={t`Similar`}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" component="h3">
                    {t`Similar`}
                </Typography>
                {data && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {sourceLabel}
                    </Typography>
                )}
                <CustomTooltip title={t`Refresh`}>
                    <span>
                        <IconButton size="small" onClick={refresh} disabled={isLoading} sx={{ ml: 'auto' }}>
                            <RefreshIcon fontSize="small" />
                        </IconButton>
                    </span>
                </CustomTooltip>
            </Stack>
            {data && (
                <RecFilterBar
                    filters={filters}
                    onFiltersChange={setFilters}
                    sort={filters.sort}
                    sortOptions={sortOptions}
                    onSortChange={(sort) => setFilters({ ...filters, sort: sort as RecSort })}
                    tagOptions={tagOptions}
                    showHiddenGems
                />
            )}
            {data && seen.myList.isUnavailable && (
                <MyListNotice userName={seen.myList.userName} onRetry={seen.myList.refresh} />
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
