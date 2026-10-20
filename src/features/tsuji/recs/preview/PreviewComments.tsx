/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useLingui } from '@lingui/react/macro';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { getAllTitles, getDisplayTitle } from '@/features/tsuji/recs/media.ts';
import type { CommentChapter } from '@/features/tsuji/comments/chapterNav.ts';
import { findCommentedChapter } from '@/features/tsuji/comments/chapterNav.ts';
import { comickSource, resolveComickSeriesByAniList } from '@/features/tsuji/comments/commentsService.ts';
import { useCommentsSettings } from '@/features/tsuji/comments/useComments.ts';
import { CommentsView } from '@/features/tsuji/comments/components/CommentsPanel.tsx';
import { isUnmatchedMedia } from '@/features/tsuji/tags/baka.ts';

type State =
    | { status: 'loading' }
    | { status: 'none' }
    | { status: 'unreachable' }
    | { status: 'ready'; seriesKey: string; chapters: CommentChapter[]; chapterNumber: number };

const Notice = ({ children }: { children: string }) => (
    <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
        {children}
    </Typography>
);

/**
 * Comments tab of the preview: the Comick series whose `links.al` is this AniList entry (never a fuzzy title
 * match), opened on the newest of its last 3 chapters that has comments, with the chapter picker. Mounted only when the tab opens.
 */
export const PreviewComments = ({ media }: { media: RecMedia }) => {
    const { t } = useLingui();
    const settings = useCommentsSettings();
    const isDesktop = useMediaQuery('(min-width: 900px)');
    const [state, setState] = useState<State>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const isOn = settings.isEnabled && settings.isComickEnabled;

    useEffect(() => {
        if (settings.isLoading || !isOn || isUnmatchedMedia(media)) {
            return undefined;
        }
        const controller = new AbortController();
        const { signal } = controller;
        setState({ status: 'loading' });
        const titles = getAllTitles(media).filter((title): title is string => !!title);
        resolveComickSeriesByAniList(media.id, titles, signal)
            .then(async (seriesKey) => {
                if (!seriesKey) {
                    return { status: 'none' } as const;
                }
                const numbers = await comickSource.chapterNumbers(seriesKey, signal);
                const chapterNumber = await findCommentedChapter(numbers, async (number) => {
                    const thread = await comickSource.thread(seriesKey, number, signal);
                    return !!thread && !!(await comickSource.comments(thread, null, signal)).comments.length;
                });
                return chapterNumber === null
                    ? ({ status: 'none' } as const)
                    : ({
                          status: 'ready',
                          seriesKey,
                          chapters: numbers.map((number) => ({ number, label: `Ch. ${number}` })),
                          chapterNumber,
                      } as const);
            })
            .then((next) => !signal.aborted && setState(next))
            .catch(() => !signal.aborted && setState({ status: 'unreachable' }));
        return () => controller.abort();
    }, [media.id, settings.isLoading, isOn, attempt]);

    if (!settings.isLoading && !isOn) {
        return <Notice>{t`Comments are off. Turn them on in Discover settings.`}</Notice>;
    }
    if (isUnmatchedMedia(media) || state.status === 'none') {
        return <Notice>{t`No comments found`}</Notice>;
    }
    if (state.status === 'unreachable') {
        return (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, py: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`Comments relay unreachable`}
                </Typography>
                <Button size="small" onClick={() => setAttempt((value) => value + 1)}>
                    {t`Retry`}
                </Button>
            </Stack>
        );
    }
    if (state.status === 'loading') {
        return (
            <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 4 }} aria-label={t`Loading comments`} />
        );
    }

    return (
        <Box sx={{ height: '60vh', mx: -3 }}>
            <CommentsView
                target={{
                    manga: { id: media.id, title: getDisplayTitle(media) },
                    chapterNumber: state.chapterNumber,
                    seriesKey: state.seriesKey,
                }}
                chapters={state.chapters}
                isDesktop={isDesktop}
            />
        </Box>
    );
};
