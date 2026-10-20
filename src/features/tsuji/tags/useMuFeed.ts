/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { FeedPhase } from '@/features/tsuji/discover/landing.ts';
import type { ComicType, RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { useCommentsSettings } from '@/features/tsuji/comments/useComments.ts';
import type { AniListChips, MuSelection } from '@/features/tsuji/tags/muSearch.ts';
import { buildMuQueries, mergeMuSeries, passesAniListChips, toUnmatchedMedia } from '@/features/tsuji/tags/muSearch.ts';
import { matchMuSeries, searchMuSeries } from '@/features/tsuji/tags/muService.ts';

const PER_PAGE = 50;

/**
 * One page of the MU search as cards: the page of every query (merged, de-duplicated against earlier pages),
 * matched to AniList; AniList-only chips filter the matched media, adult AniList media drop out unless allowed.
 */
export const loadMuPage = async ({
    mu,
    aniListChips,
    types,
    sort,
    showAdult,
    page,
    seenSeriesIds,
    signal,
}: {
    mu: MuSelection;
    aniListChips: AniListChips;
    types: ComicType[];
    sort: string;
    showAdult: boolean;
    page: number;
    seenSeriesIds: Set<number>;
    signal: AbortSignal;
}): Promise<{ media: RecMedia[]; hasNextPage: boolean }> => {
    const queries = buildMuQueries({ mu, types, sort, showAdult, page, perPage: PER_PAGE });
    const results = [];
    for (const query of queries) {
        // oxlint-disable-next-line no-await-in-loop
        results.push(await searchMuSeries(query, signal));
    }
    const series = mergeMuSeries(results.map(({ series: list }) => list)).filter(
        ({ seriesId }) => !seenSeriesIds.has(seriesId),
    );
    series.forEach(({ seriesId }) => seenSeriesIds.add(seriesId));
    const matches = await matchMuSeries(series, signal);
    const media = series
        .map((each) => ({ each, match: matches.get(each.seriesId) ?? null }))
        .filter(({ match }) => passesAniListChips(match, aniListChips) && (showAdult || !match?.isAdult))
        .map(({ each, match }) => match ?? toUnmatchedMedia(each));
    return { media, hasNextPage: results.some(({ total }) => total > page * PER_PAGE) };
};

type MuFeedState = { key: string; pages: RecMedia[][]; hasNextPage: boolean; status: 'idle' | 'loading' | 'error' };

const createState = (key: string): MuFeedState => ({ key, pages: [], hasNextPage: true, status: 'idle' });

/** Paged MU-backed feed with the same shape as useDiscoverFeed (Discover swaps them by search engine). */
export const useMuFeed = ({
    mu,
    aniListChips,
    types,
    sort,
    showAdult,
    isEnabled,
}: {
    mu: MuSelection;
    aniListChips: AniListChips;
    types: ComicType[];
    sort: string;
    showAdult: boolean;
    isEnabled: boolean;
}) => {
    // Applies `tsuji_commentsRelay` (the MU proxy lives on the comments relay).
    useCommentsSettings();
    const key = useMemo(
        () => JSON.stringify({ mu, aniListChips, types, sort, showAdult }),
        [mu, aniListChips, types, sort, showAdult],
    );
    const [state, setState] = useState<MuFeedState>(() => createState(key));
    const current = state.key === key ? state : createState(key);
    const currentRef = useRef(current);
    currentRef.current = current;
    const controllerRef = useRef<AbortController | null>(null);
    const seenRef = useRef<{ key: string; ids: Set<number> }>({ key, ids: new Set() });

    useEffect(() => {
        controllerRef.current?.abort();
        seenRef.current = { key, ids: new Set() };
        setState(createState(key));
    }, [key]);
    useEffect(() => () => controllerRef.current?.abort(), []);

    const loadMore = useCallback(() => {
        const feed = currentRef.current;
        if (!isEnabled || feed.status === 'loading' || !feed.hasNextPage) {
            return;
        }
        const controller = new AbortController();
        controllerRef.current = controller;
        setState({ ...feed, status: 'loading' });
        loadMuPage({
            mu,
            aniListChips,
            types,
            sort,
            showAdult,
            page: feed.pages.length + 1,
            seenSeriesIds: seenRef.current.ids,
            signal: controller.signal,
        })
            .then((page) => {
                if (!controller.signal.aborted) {
                    setState((previous) =>
                        previous.key === feed.key
                            ? {
                                  ...previous,
                                  pages: [...previous.pages, page.media],
                                  hasNextPage: page.hasNextPage,
                                  status: 'idle',
                              }
                            : previous,
                    );
                }
            })
            .catch((error) => {
                if (controller.signal.aborted) {
                    return;
                }
                defaultPromiseErrorHandler('useMuFeed')(error);
                setState((previous) => (previous.key === feed.key ? { ...previous, status: 'error' } : previous));
            });
    }, [isEnabled, mu, aniListChips, types, sort, showAdult]);

    const shouldLoadFirstPage = isEnabled && !current.pages.length && current.status === 'idle';
    useEffect(() => {
        if (shouldLoadFirstPage) {
            loadMore();
        }
    }, [shouldLoadFirstPage, loadMore]);

    const retry = useCallback(() => setState((previous) => ({ ...previous, status: 'idle' })), []);
    const phase = ((): FeedPhase => {
        if (!isEnabled) {
            return 'off';
        }
        if (current.pages.length) {
            return current.pages[0].length ? 'ready' : 'empty';
        }
        return current.status === 'error' ? 'failed' : 'pending';
    })();

    return {
        phase,
        pages: current.pages,
        hasNextPage: current.hasNextPage,
        isLoading: current.status === 'loading' || (isEnabled && !current.pages.length && current.status === 'idle'),
        isError: current.status === 'error',
        serverSort: null as string | null,
        loadMore,
        retry,
    };
};
