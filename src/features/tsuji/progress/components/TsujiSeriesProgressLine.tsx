/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';
import { formatChapterNumber, getChaptersLeft } from '@/features/tsuji/progress/progress.ts';
import { useMangaProgress } from '@/features/tsuji/progress/useMangaProgress.ts';

/** "Ch 21 / 200 · 179 left" under the title on the series page. */
export const TsujiSeriesProgressLine = ({ mangaId }: { mangaId: number }) => {
    const { t } = useLingui();
    const progress = useMangaProgress(mangaId);

    if (!progress) {
        return null;
    }

    const read = formatChapterNumber(progress.read);
    const left = getChaptersLeft(progress);

    const text = (() => {
        if (progress.total === null || left === null) {
            return t`Ch ${read}`;
        }

        const total = formatChapterNumber(progress.total);
        if (left === 0) {
            return t`Ch ${read} / ${total} · caught up`;
        }

        const remaining = formatChapterNumber(left);
        return t`Ch ${read} / ${total} · ${remaining} left`;
    })();

    return (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            {text}
        </Typography>
    );
};
