/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useMemo } from 'react';
import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';
import { useReaderChaptersStore } from '@/features/reader/stores/ReaderStore.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { formatChapterNumber, getReaderDenominator, getReaderProgress } from '@/features/tsuji/progress/progress.ts';
import { useTsujiFlag } from '@/features/tsuji/services/TsujiMetadata.ts';

/**
 * "Ch. 21 / 200" under the desktop reader's chapter picker. The denominator comes from `mangaChapters`, the full
 * chapter list frozen at the first reader load (reader filters don't apply to it), so it's computed once per session.
 */
export const TsujiReaderChapterProgress = () => {
    const { t } = useLingui();
    const isEnabled = useTsujiFlag(TSUJI_META_KEYS.readerChapterProgress);
    const mangaChapters = useReaderChaptersStore('mangaChapters');
    const currentNumber = useReaderChaptersStore((state) => state.currentChapter?.chapterNumber);

    const denominator = useMemo(
        () => getReaderDenominator(mangaChapters?.map(({ chapterNumber }) => chapterNumber) ?? []),
        [mangaChapters],
    );
    const progress = getReaderProgress(currentNumber, denominator);

    if (!isEnabled || !progress) {
        return null;
    }

    const current = formatChapterNumber(progress.current);
    const total = progress.total === null ? null : formatChapterNumber(progress.total);

    return (
        <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            {total === null ? t`Ch. ${current}` : t`Ch. ${current} / ${total}`}
        </Typography>
    );
};
