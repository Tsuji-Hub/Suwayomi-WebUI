/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import { useReaderChaptersStore, useReaderStore } from '@/features/reader/stores/ReaderStore.ts';
import { GET_CHAPTERS_MANGA } from '@/lib/graphql/chapter/ChapterQuery.ts';
import type { GetChaptersMangaQuery, GetChaptersMangaQueryVariables } from '@/lib/graphql/generated/graphql.ts';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { buildCommentChapters, getLastReadScanlator } from '@/features/tsuji/comments/chapterNav.ts';
import {
    closeCommentsPanel,
    openCommentsPanel,
    useCommentsPanelStore,
} from '@/features/tsuji/comments/commentsPanelStore.ts';
import { CommentsPanel } from '@/features/tsuji/comments/components/CommentsPanel.tsx';
import { useCommentsSettings } from '@/features/tsuji/comments/useComments.ts';

/** Series view: the first chapter's discussion (never later chapters, no spoilers). */
const SERIES_CHAPTER = 1;

/** "Comments" pill next to the Similar header; opens chapter 1's Comick thread. Hidden while comments are off. */
export const CommentsPill = ({ manga }: { manga: { id: number } }) => {
    const { t } = useLingui();
    const settings = useCommentsSettings();

    if (settings.isLoading || !settings.isEnabled) {
        return null;
    }

    return (
        <Button
            size="small"
            variant="outlined"
            startIcon={<CommentOutlinedIcon fontSize="small" />}
            onClick={() => openCommentsPanel({ mangaId: manga.id, chapterNumber: SERIES_CHAPTER })}
            sx={{ borderRadius: 999, py: 0 }}
        >
            {t`Comments`}
        </Button>
    );
};

/**
 * The series page's one Comments panel, opened by the pill (chapter 1) and the chapter rows (that chapter). The
 * selector lists the chapters the page already loaded (Apollo cache), labelled by the opened or last read copy.
 */
export const SeriesCommentsHost = ({ manga }: { manga: { id: number; title: string } }) => {
    const request = useCommentsPanelStore((state) => state.request);
    const isOpen = request?.mangaId === manga.id;
    const { data } = requestManager.useGetMangaChapters<GetChaptersMangaQuery, GetChaptersMangaQueryVariables>(
        GET_CHAPTERS_MANGA,
        manga.id,
        { skip: !isOpen, fetchPolicy: 'cache-first' },
    );
    const nodes = data?.chapters.nodes;
    const reference = request?.scanlator !== undefined ? request.scanlator : getLastReadScanlator(nodes ?? []);
    const chapters = useMemo(() => buildCommentChapters(nodes ?? [], reference), [nodes, reference]);

    // Leaving the page (back button) with the panel open: don't reopen it on the next visit.
    useEffect(
        () => () => {
            if (useCommentsPanelStore.getState().request?.mangaId === manga.id) {
                closeCommentsPanel();
            }
        },
        [manga.id],
    );

    return (
        <CommentsPanel
            target={{ manga: { id: manga.id, title: manga.title }, chapterNumber: request?.chapterNumber ?? 1 }}
            chapters={chapters}
            isOpen={isOpen}
            onClose={closeCommentsPanel}
        />
    );
};

/** Reader: comments of the chapter being read. `desktop` is a text button in the nav bar, `mobile` an icon. */
export const TsujiReaderCommentsButton = ({ variant }: { variant: 'desktop' | 'mobile' }) => {
    const { t } = useLingui();
    const settings = useCommentsSettings();
    const manga = useReaderStore('manga');
    const mangaChapters = useReaderChaptersStore('mangaChapters');
    const currentChapter = useReaderChaptersStore('currentChapter');
    const [isOpen, setIsOpen] = useState(false);
    const scanlator = currentChapter?.scanlator ?? null;
    const chapters = useMemo(
        () => (isOpen ? buildCommentChapters(mangaChapters ?? [], scanlator) : []),
        [isOpen, mangaChapters, scanlator],
    );

    if (settings.isLoading || !settings.isEnabled || !manga || !currentChapter) {
        return null;
    }

    const panel = (
        <CommentsPanel
            target={{ manga: { id: manga.id, title: manga.title }, chapterNumber: currentChapter.chapterNumber }}
            chapters={chapters}
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
        />
    );

    return variant === 'desktop' ? (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={<CommentOutlinedIcon fontSize="small" />}
                onClick={() => setIsOpen(true)}
            >
                {t`Comments`}
            </Button>
            {panel}
        </>
    ) : (
        <>
            <CustomTooltip title={t`Comments`}>
                <IconButton onClick={() => setIsOpen(true)} color="inherit" aria-label={t`Comments`}>
                    <CommentOutlinedIcon />
                </IconButton>
            </CustomTooltip>
            {panel}
        </>
    );
};
