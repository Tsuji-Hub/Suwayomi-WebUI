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
import type { AniListChips, MuSelection, MuSeries } from '@/features/tsuji/tags/muSearch.ts';
import { buildMuQueries, mergeMuSeries, splitAniListChips, toMuCards } from '@/features/tsuji/tags/muSearch.ts';
import { matchMuSeries, searchMuSeries } from '@/features/tsuji/tags/muService.ts';

const PER_PAGE = 50;

/**
 * One page of the MU search: the page of every query, merged and de-duplicated against earlier pages. AniList-only
 * chips that are MU genres go to MU as genre / exclude_genre.
 */
export const fetchMuPage = async ({
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
}): Promise<{ series: MuSeries[]; hasNextPage: boolean }> => {
    const { muGenres } = splitAniListChips(aniListChips);
    const queries = buildMuQueries({ mu, muGenres, types, sort, showAdult, page, perPage: PER_PAGE });
    const results = [];
    for (const query of queries) {
        // oxlint-disable-next-line no-await-in-loop
        results.push(await searchMuSeries(query, signal));
    }
    const series = mergeMuSeries(results.map(({ series: list }) => list)).filter(
        ({ seriesId }) => !seenSeriesIds.has(seriesId),
    );
    series.forEach(({ seriesId }) => seenSeriesIds.add(seriesId));
    return { series, hasNextPage: results.some(({ total }) => total > page * PER_PAGE) };
};

type MuFeedState = { key: string; pages: MuSeries[][]; hasNextPage: boolean; status: 'idle' | 'loading' | 'error' };

const createState = (key: string): MuFeedState => ({ key, pages: [], hasNextPage: true, status: 'idle' });

/**
 * Paged MU-backed feed with the same shape as useDiscoverFeed (Discover swaps them by search engine). A page shows
 * as soon as MU answers; AniList matches run behind it, page by page in order, and fill the cards in as they land.
 */
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
    // Verdicts are per series, whatever the selection, so they outlive a selection change.
    const [matches, setMatches] = useState<ReadonlyMap<number, RecMedia | null>>(() => new Map());
    const controllerRef = useRef<AbortController | null>(null);
    const matchChainRef = useRef<Promise<unknown>>(Promise.resolve());
    const seenRef = useRef<{ key: string; ids: Set<number> }>({ key, ids: new Set() });

    useEffect(() => {
        controllerRef.current?.abort();
        controllerRef.current = new AbortController();
        matchChainRef.current = Promise.resolve();
        seenRef.current = { key, ids: new Set() };
        setState(createState(key));
    }, [key]);
    useEffect(() => () => controllerRef.current?.abort(), []);

    const matchInBackground = useCallback((series: MuSeries[], signal: AbortSignal) => {
        const addMatches = (batch: Map<number, RecMedia | null>) => {
            if (!signal.aborted) {
                setMatches((previous) => new Map([...previous, ...batch]));
            }
        };
        // Pages match one after the other, so the visible page's cards fill in first.
        matchChainRef.current = matchChainRef.current
            .then(() => (signal.aborted ? null : matchMuSeries(series, signal, addMatches)))
            .catch((error) => {
                if (!signal.aborted) {
                    defaultPromiseErrorHandler('useMuFeed::match')(error);
                }
            });
    }, []);

    const loadMore = useCallback(() => {
        const feed = currentRef.current;
        const controller = controllerRef.current;
        if (!isEnabled || !controller || feed.status === 'loading' || !feed.hasNextPage) {
            return;
        }
        const { signal } = controller;
        setState({ ...feed, status: 'loading' });
        fetchMuPage({
            mu,
            aniListChips,
            types,
            sort,
            showAdult,
            page: feed.pages.length + 1,
            seenSeriesIds: seenRef.current.ids,
            signal,
        })
            .then((page) => {
                if (signal.aborted) {
                    return;
                }
                setState((previous) =>
                    previous.key === feed.key
                        ? {
                              ...previous,
                              pages: [...previous.pages, page.series],
                              hasNextPage: page.hasNextPage,
                              status: 'idle',
                          }
                        : previous,
                );
                matchInBackground(page.series, signal);
            })
            .catch((error) => {
                if (signal.aborted) {
                    return;
                }
                defaultPromiseErrorHandler('useMuFeed')(error);
                setState((previous) => (previous.key === feed.key ? { ...previous, status: 'error' } : previous));
            });
    }, [isEnabled, mu, aniListChips, types, sort, showAdult, matchInBackground]);

    const shouldLoadFirstPage = isEnabled && !current.pages.length && current.status === 'idle';
    useEffect(() => {
        if (shouldLoadFirstPage) {
            loadMore();
        }
    }, [shouldLoadFirstPage, loadMore]);

    const postFilter = useMemo(() => splitAniListChips(aniListChips).postFilter, [aniListChips]);
    const pages = useMemo(
        () => toMuCards(current.pages, matches, { postFilter, showAdult }),
        [current.pages, matches, postFilter, showAdult],
    );

    const retry = useCallback(() => setState((previous) => ({ ...previous, status: 'idle' })), []);
    const phase = ((): FeedPhase => {
        if (!isEnabled) {
            return 'off';
        }
        if (pages.length) {
            return pages.some((page) => page.length) ? 'ready' : 'empty';
        }
        return current.status === 'error' ? 'failed' : 'pending';
    })();

    return {
        phase,
        pages,
        hasNextPage: current.hasNextPage,
        isLoading: current.status === 'loading' || (isEnabled && !current.pages.length && current.status === 'idle'),
        isError: current.status === 'error',
        serverSort: null as string | null,
        loadMore,
        retry,
    };
};
