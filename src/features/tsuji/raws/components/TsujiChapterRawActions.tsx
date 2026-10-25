/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import CompareIcon from '@mui/icons-material/Compare';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import TranslateIcon from '@mui/icons-material/Translate';
import { useLingui } from '@lingui/react/macro';
import { MenuItem } from '@/base/components/menu/MenuItem.tsx';
import { Chapters } from '@/features/chapter/services/Chapters.ts';
import type { ChapterListFilterOptions } from '@/features/chapter/Chapter.types.ts';
import { filterChapters } from '@/features/chapter/utils/ChapterList.util.tsx';
import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';
import { setCompareActive } from '@/features/tsuji/raws/compareStore.ts';
import { mergeInlineMtl } from '@/features/tsuji/raws/crossSeries.ts';
import { formatNumber, getMissingNumbers } from '@/features/tsuji/raws/mtlStatus.ts';
import type { SeriesChapter } from '@/features/tsuji/raws/useSeriesMtl.ts';
import { isMtlManga, useSeriesMtl, useSeriesMtlStore } from '@/features/tsuji/raws/useSeriesMtl.ts';
import { EnglishRanOutPanel } from '@/features/tsuji/raws/components/EnglishRanOutPanel.tsx';

/*
 * The chapter list's part of brief #19: MTL chapters inline where English has none (in the scanlator filter), a badge
 * on them, the "Missing N chapters" row's per-number actions, and the chapter menu's raw actions.
 */

/** Missing numbers shown with actions per row; the rest are counted. */
const MISSING_SHOWN = 10;

/**
 * Upstream hook (ChapterList): the visible chapters with the MTL chapters English lacks, placed by number, under the
 * list's own filters (unread, downloaded, bookmarked; not the scanlator one).
 */
export const useTsujiInlineMtl = (manga: { id: number } & Partial<GqlMetaHolder>) => {
    const series = useSeriesMtl(manga, { publish: true });
    return useCallback(
        <T extends SeriesChapter>(list: T[], options: ChapterListFilterOptions & { reverse: boolean }): T[] => {
            if (!series?.mtlByNumber.size) {
                return list;
            }
            const mtl = filterChapters([...series.mtlByNumber.values()] as T[], { ...options, excludedScanlators: [] });
            return mergeInlineMtl(list, mtl, series.englishNumbers, options.reverse);
        },
        [series],
    );
};

/** "MTL" on an inline MTL chapter row. */
export const TsujiMtlBadge = ({ chapter }: { chapter: { mangaId: number } }) => {
    const { t } = useLingui();
    const isMtl = useSeriesMtlStore((state) => isMtlManga(state, chapter.mangaId));

    if (!isMtl) {
        return null;
    }

    return (
        <Chip label={t`MTL`} size="small" color="secondary" variant="outlined" sx={{ alignSelf: 'center', mx: 0.5 }} />
    );
};

/** The "Missing N chapters" row: each missing number with what the raw and the MTL have. */
export const TsujiMissingChapters = ({
    chapter,
    previousChapter,
}: {
    chapter: { mangaId: number; chapterNumber: number };
    previousChapter: { chapterNumber: number };
}) => {
    const { t } = useLingui();
    const series = useSeriesMtlStore((state) => state[chapter.mangaId]);
    const [isAllShown, setIsAllShown] = useState(false);

    if (!series?.isLoaded) {
        return null;
    }
    const numbers = getMissingNumbers(previousChapter.chapterNumber, chapter.chapterNumber).filter(
        (number) => series.rawByNumber.has(number) || series.mtlByNumber.has(number),
    );
    if (!numbers.length) {
        return null;
    }
    const shown = isAllShown ? numbers : numbers.slice(0, MISSING_SHOWN);
    const more = numbers.length - shown.length;

    return (
        <Stack sx={{ px: 2, pb: 1 }} aria-label={t`Missing chapters`}>
            {shown.map((number) => (
                <EnglishRanOutPanel key={number} series={series} number={number} variant="row" />
            ))}
            {more > 0 && (
                <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => setIsAllShown(true)}>
                    {t`Show ${more} more`}
                </Button>
            )}
        </Stack>
    );
};

/** The chapter menu's Translate dialog: kept outside the menu, which closes on a click. */
const useRawDialog = create<{ enId: number | null; number: number | null; hosts: number }>(() => ({
    enId: null,
    number: null,
    hosts: 0,
}));

/** Upstream hook (ChapterList): where the chapter menu's Translate dialog shows. */
export const TsujiRawDialogHost = () => {
    const { t } = useLingui();
    const { enId, number } = useRawDialog();
    const series = useSeriesMtlStore((state) => (enId ? state[enId] : undefined));
    const close = () => useRawDialog.setState({ enId: null, number: null });

    useEffect(() => {
        useRawDialog.setState((state) => ({ hosts: state.hosts + 1 }));
        return () => useRawDialog.setState((state) => ({ hosts: state.hosts - 1, enId: null, number: null }));
    }, []);

    const label = number !== null ? formatNumber(number) : '';

    return (
        <Dialog open={!!series && number !== null} onClose={close} maxWidth="xs" fullWidth>
            <DialogTitle>{t`Translate raw ${label}`}</DialogTitle>
            <DialogContent>
                {series && number !== null && <EnglishRanOutPanel series={series} number={number} variant="row" />}
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>{t`Close`}</Button>
            </DialogActions>
        </Dialog>
    );
};

/** Chapter menu (next to WebView): Read raw, Translate raw (MTL), Compare with raw, when the raw has the number. */
export const TsujiRawChapterMenuItems = ({
    chapter,
    onClose,
}: {
    chapter: { mangaId: number; chapterNumber?: number; sourceOrder?: number; isRead?: boolean };
    onClose: () => void;
}) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const series = useSeriesMtlStore((state) => state[chapter.mangaId]);
    const hasHost = useRawDialog((state) => state.hosts > 0);
    const number = chapter.chapterNumber ?? -1;
    const rawChapter = number >= 0 ? series?.rawByNumber.get(number) : undefined;

    if (!series || !rawChapter) {
        return null;
    }

    return (
        <>
            <MenuItem
                Icon={MenuBookIcon}
                title={t`Read raw`}
                onClick={() => {
                    onClose();
                    navigate(Chapters.getReaderUrl(rawChapter));
                }}
            />
            {hasHost && !!series.links.raw?.api && !!series.links.raw.req && (
                <MenuItem
                    Icon={TranslateIcon}
                    title={t`Translate raw (MTL)`}
                    onClick={() => {
                        onClose();
                        useRawDialog.setState({ enId: series.enId, number });
                    }}
                />
            )}
            {chapter.sourceOrder !== undefined && (
                <MenuItem
                    Icon={CompareIcon}
                    title={t`Compare with raw`}
                    onClick={() => {
                        onClose();
                        setCompareActive(true);
                        navigate(
                            Chapters.getReaderUrl({ mangaId: chapter.mangaId, sourceOrder: chapter.sourceOrder! }),
                        );
                    }}
                />
            )}
        </>
    );
};
