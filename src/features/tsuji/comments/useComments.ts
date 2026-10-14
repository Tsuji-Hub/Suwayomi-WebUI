/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { useTsujiGlobalMetaQuery } from '@/features/tsuji/services/TsujiMetadata.ts';
import type { Comment, ResolvedThread, SeriesMatch } from '@/features/tsuji/comments/CommentSource.ts';
import { parseCommentMatches } from '@/features/tsuji/comments/commentsMatch.ts';
import {
    comickSource,
    resolveRelayUrl,
    setCommentsRelayUrl,
    updateCommentMatches,
} from '@/features/tsuji/comments/commentsService.ts';

export type CommentsState =
    | { status: 'off' }
    | { status: 'loading' }
    | { status: 'unreachable' }
    | { status: 'no-match' }
    | { status: 'no-thread'; match: SeriesMatch; isManual: boolean }
    | { status: 'ready'; match: SeriesMatch; isManual: boolean; thread: ResolvedThread; comments: Comment[] };

/** Comments settings from global meta (master switch and Comick both default on). */
export const useCommentsSettings = () => {
    const { meta, isLoading } = useTsujiGlobalMetaQuery();
    const relay = resolveRelayUrl(meta[TSUJI_META_KEYS.commentsRelay]);
    useEffect(() => setCommentsRelayUrl(relay), [relay]);

    return {
        isLoading,
        isEnabled: meta[TSUJI_META_KEYS.comments] !== 'false',
        isComickEnabled: meta[TSUJI_META_KEYS.commentsComick] !== 'false',
        relay,
        storedRelay: meta[TSUJI_META_KEYS.commentsRelay] ?? '',
        matches: parseCommentMatches(meta[TSUJI_META_KEYS.commentsMatch]),
    };
};

/**
 * One chapter's Comick discussion for a manga (series view: chapter 1; reader: the current chapter; never later
 * chapters). Loads only while `isActive` (the panel is open). A manual match from `tsuji_commentsMatch` wins over
 * the title search.
 */
export const useComments = ({
    manga,
    chapterNumber,
    isActive,
}: {
    manga: { id: number; title: string };
    chapterNumber: number;
    isActive: boolean;
}) => {
    const settings = useCommentsSettings();
    const [state, setState] = useState<CommentsState>({ status: 'loading' });
    const [reloadCount, setReloadCount] = useState(0);
    const manualKey = settings.matches[String(manga.id)];
    const isOn = settings.isEnabled && settings.isComickEnabled;

    useEffect(() => {
        if (!isActive || settings.isLoading) {
            return undefined;
        }
        if (!isOn) {
            setState({ status: 'off' });
            return undefined;
        }

        const controller = new AbortController();
        const { signal } = controller;
        setState({ status: 'loading' });

        const load = async (): Promise<CommentsState> => {
            const match = manualKey
                ? { seriesKey: manualKey, title: manga.title }
                : await comickSource.resolveSeries([manga.title], signal);
            if (!match) {
                return { status: 'no-match' };
            }
            const isManual = !!manualKey;
            const thread = await comickSource.thread(match.seriesKey, chapterNumber, signal);
            if (!thread) {
                return { status: 'no-thread', match, isManual };
            }
            const page = await comickSource.comments(thread, null, signal);
            return { status: 'ready', match, isManual, thread, comments: page.comments };
        };

        load()
            .then((next) => !signal.aborted && setState(next))
            .catch(() => {
                // The relay being down (or answering garbage) is an expected state: one quiet line, no console spam.
                if (!signal.aborted) {
                    setState({ status: 'unreachable' });
                }
            });

        return () => controller.abort();
    }, [
        isActive,
        settings.isLoading,
        isOn,
        manga.id,
        manga.title,
        chapterNumber,
        manualKey,
        settings.relay,
        reloadCount,
    ]);

    const retry = useCallback(() => setReloadCount((count) => count + 1), []);
    const setManualMatch = useCallback(
        (seriesKey: string | null) => updateCommentMatches({ [String(manga.id)]: seriesKey }),
        [manga.id],
    );

    return useMemo(() => ({ state, retry, setManualMatch }), [state, retry, setManualMatch]);
};
