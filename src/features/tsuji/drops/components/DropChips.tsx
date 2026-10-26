/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { useFragment } from '@apollo/client/react';
import { useLingui } from '@lingui/react/macro';
import type { MangaCardMode } from '@/features/manga/Manga.types.ts';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import type { TsujiMangaDropFieldsFragment } from '@/lib/graphql/generated/graphql.ts';
import { TSUJI_MANGA_DROP_FIELDS } from '@/features/tsuji/graphql/TsujiFragments.ts';
import { TSUJI_PALETTE } from '@/features/tsuji/Tsuji.palette.ts';
import type { DropIndex, DropIndexItem } from '@/features/tsuji/drops/drops.ts';
import { formatDropPct, getDropBand, hasEnoughStarters } from '@/features/tsuji/drops/drops.ts';
import { loadTier1, useDropIndex, useDropIndexState } from '@/features/tsuji/drops/dropService.ts';
import { getMangaAniListId } from '@/features/tsuji/drops/useMangaAniListId.ts';
import { DROP_BAND_COLOR } from '@/features/tsuji/drops/components/dropColors.ts';

/*
 * Small "▼3%" chips (brief #20): library cards and recommendation cards from the relay's index (one request for every
 * card, never one per card), only with 200+ readers who started it; the preview dialog asks AniList once when the
 * title isn't in the index.
 */

const getChip = (item: DropIndexItem | undefined, index: DropIndex | null) =>
    item && hasEnoughStarters(item.started)
        ? {
              text: `▼${Math.round(item.dropPct)}%`,
              color: DROP_BAND_COLOR[getDropBand(item.dropPct, index?.medianDropPct) ?? 'typical'],
          }
        : null;

const LibraryBadge = styled(Typography)(({ theme }) => ({
    paddingInline: theme.spacing(0.3),
    backgroundColor: TSUJI_PALETTE.progressBadge,
}));

const LibraryDropBadgeContent = ({ mangaId }: { mangaId: number }) => {
    const { t } = useLingui();
    const index = useDropIndex();
    const { data, complete } = useFragment<TsujiMangaDropFieldsFragment>({
        fragment: TSUJI_MANGA_DROP_FIELDS,
        fragmentName: 'TSUJI_MANGA_DROP_FIELDS',
        from: { __typename: 'MangaType', id: mangaId },
        client: requestManager.graphQLClient.client,
    });
    const anilistId = complete ? getMangaAniListId(data) : null;
    const item = anilistId ? index?.items.get(anilistId) : undefined;
    const chip = getChip(item, index);

    if (!chip || !item) {
        return null;
    }
    const pct = formatDropPct(item.dropPct);
    return (
        <LibraryBadge title={t`${pct} % of readers dropped it (AniList)`} sx={{ color: chip.color }}>
            {chip.text}
        </LibraryBadge>
    );
};

/** Library card badge (MangaBadges, library mode only: the AniList ids are in the library's cache). */
export const TsujiDropBadge = ({ mangaId, mode }: { mangaId: number; mode: MangaCardMode }) =>
    mode === 'default' ? <LibraryDropBadgeContent mangaId={mangaId} /> : null;

/** Recommendation card chip (Discover, For You, Similar). */
export const RecDropChip = ({ anilistId }: { anilistId: number }) => {
    const { t } = useLingui();
    const index = useDropIndex(anilistId > 0);
    const item = anilistId > 0 ? index?.items.get(anilistId) : undefined;
    const chip = getChip(item, index);

    if (!chip || !item) {
        return null;
    }
    const pct = formatDropPct(item.dropPct);
    return (
        <Typography variant="caption" title={t`${pct} % of readers dropped it (AniList)`} sx={{ color: chip.color }}>
            {chip.text}
        </Typography>
    );
};

/** The preview's "3.2 % dropped": from the index, else one AniList request when the preview opens. */
export const useDropFact = (anilistId: number | null): string | null => {
    const { t } = useLingui();
    const { index, isSettled: isIndexSettled } = useDropIndexState(!!anilistId);
    const item = anilistId ? index?.items.get(anilistId) : undefined;
    const [tier1, setTier1] = useState<{ id: number; dropPct: number; started: number } | null>(null);

    useEffect(() => {
        if (!anilistId || item || !isIndexSettled) {
            return undefined;
        }
        let isCurrent = true;
        loadTier1(anilistId).then((data) => {
            if (isCurrent && data) {
                setTier1({ id: anilistId, dropPct: data.dropPct, started: data.started });
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [anilistId, !!item, isIndexSettled]);

    const source = item ?? (tier1 && tier1.id === anilistId ? tier1 : null);
    if (!source || !hasEnoughStarters(source.started)) {
        return null;
    }
    const pct = formatDropPct(source.dropPct);
    return t`${pct} % dropped`;
};
