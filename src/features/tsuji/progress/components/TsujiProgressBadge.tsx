/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import type { MangaCardMode } from '@/features/manga/Manga.types.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { TSUJI_PALETTE } from '@/features/tsuji/Tsuji.palette.ts';
import { formatSeriesProgress } from '@/features/tsuji/progress/progress.ts';
import { useMangaProgress } from '@/features/tsuji/progress/useMangaProgress.ts';
import { useTsujiFlag } from '@/features/tsuji/services/TsujiMetadata.ts';

/** Matches upstream's MangaBadges `Badge` so it joins the unread/download pill. */
const ProgressBadge = styled(Typography)(({ theme }) => ({
    paddingInline: theme.spacing(0.3),
    backgroundColor: TSUJI_PALETTE.progressBadge,
    color: TSUJI_PALETTE.badgeText,
}));

const ProgressBadgeContent = ({ mangaId }: { mangaId: number }) => {
    const progress = useMangaProgress(mangaId);

    if (!progress) {
        return null;
    }

    return <ProgressBadge>{formatSeriesProgress(progress)}</ProgressBadge>;
};

/** "21/200" next to the unread badge on library cards (grid + list). */
export const TsujiProgressBadge = ({ mangaId, mode }: { mangaId: number; mode: MangaCardMode }) => {
    const isEnabled = useTsujiFlag(TSUJI_META_KEYS.libraryProgressBadge);

    // Only library cards ("default" mode) have the progress fields in the cache.
    if (mode !== 'default' || !isEnabled) {
        return null;
    }

    return <ProgressBadgeContent mangaId={mangaId} />;
};
