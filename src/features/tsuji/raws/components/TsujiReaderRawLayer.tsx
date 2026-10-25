/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import { useLingui } from '@lingui/react/macro';
import { Chapters } from '@/features/chapter/services/Chapters.ts';
import { isContinuousVerticalReadingMode } from '@/features/reader/settings/ReaderSettings.utils.tsx';
import {
    useReaderChaptersStore,
    useReaderPagesStore,
    useReaderSettingsStore,
    useReaderStore,
} from '@/features/reader/stores/ReaderStore.ts';
import { GET_CHAPTERS_MANGA } from '@/lib/graphql/chapter/ChapterQuery.ts';
import { GET_MANGA_META } from '@/lib/graphql/manga/MangaQuery.ts';
import type {
    GetChaptersMangaQuery,
    GetChaptersMangaQueryVariables,
    GetMangaMetaQuery,
    GetMangaMetaQueryVariables,
} from '@/lib/graphql/generated/graphql.ts';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { readTsujiMangaMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { measureChapter } from '@/features/tsuji/reader/chapterPagesRegistry.ts';
import { setCompareActive, useCompareStore, useEndCardStore } from '@/features/tsuji/raws/compareStore.ts';
import { getChapterFraction, getPaneScrollTop } from '@/features/tsuji/raws/compareSync.ts';
import { getMangaIdFromUrl, parseRawLinks } from '@/features/tsuji/raws/rawLinks.ts';
import { useRawFeedRow } from '@/features/tsuji/raws/rawFeed.ts';
import { buildRawChapterMap } from '@/features/tsuji/raws/rawNumbering.ts';
import { fetchMtlStatus, getMtlEntry, getMtlKey, useMtlChapter } from '@/features/tsuji/raws/mtlEngine.ts';
import { getReadablePath, isMtlPending } from '@/features/tsuji/raws/mtlStatus.ts';
import { refetchChapterPagesInPlace } from '@/features/tsuji/raws/chapterRefetch.ts';
import {
    clearForeignChapters,
    setForeignChapters,
    tsujiOpenForeignChapter,
    useTsujiForeignTargets,
} from '@/features/tsuji/raws/mtlSequence.ts';
import type { SeriesChapter, SeriesMtl } from '@/features/tsuji/raws/useSeriesMtl.ts';
import { getMtlRef, refreshMangaChapters, useMtlParent, useSeriesMtl } from '@/features/tsuji/raws/useSeriesMtl.ts';
import { EnglishRanOutPanel } from '@/features/tsuji/raws/components/EnglishRanOutPanel.tsx';

/** How far into the chapter counts as its end (vertical modes). */
const END_FRACTION = 0.9;

type ScrollElementRef = { readonly current: HTMLElement | null };

const RawImage = styled('img')({ display: 'block', width: '100%', height: 'auto' });

const useMangaChapters = (mangaId: number | null) =>
    requestManager.useGetMangaChapters<GetChaptersMangaQuery, GetChaptersMangaQueryVariables>(
        GET_CHAPTERS_MANGA,
        mangaId ?? -1,
        { skip: !mangaId },
    ).data?.chapters.nodes;

/** The English reader's links (meta) and feed row, for Compare and the end-of-release offer. */
export const useReaderRawLinks = () => {
    const manga = useReaderStore('manga');
    const links = useMemo(
        () => parseRawLinks(manga ? readTsujiMangaMeta(manga, TSUJI_META_KEYS.rawLinks) : undefined),
        [manga],
    );
    const { row } = useRawFeedRow(links.raw || links.mtl ? manga?.id : null);
    const mtlId = links.mtl?.mangaId ?? (row ? getMangaIdFromUrl(row.mtlUrl) : null);
    return { manga, rawId: links.raw?.mangaId ?? (row?.rawId || null), mtlId, row };
};

/**
 * Right half of the window: the raw chapter with the English chapter's number (numbering from the raw names),
 * scrolled to the same fraction of its chapter as the English side. It takes no input itself: wheel and clicks over
 * it reach the English reader, which leads.
 */
const ComparePane = ({
    rawId,
    origin,
    chapterId,
    chapterNumber,
    scrollElementRef,
}: {
    rawId: number;
    origin: Parameters<typeof buildRawChapterMap>[1];
    chapterId: number;
    chapterNumber: number;
    scrollElementRef: ScrollElementRef;
}) => {
    const { t } = useLingui();
    const paneRef = useRef<HTMLDivElement | null>(null);
    const rawChapters = useMangaChapters(rawId);
    const rawChapter = useMemo(
        () => (rawChapters ? (buildRawChapterMap(rawChapters, origin).get(chapterNumber) ?? null) : undefined),
        [rawChapters, origin, chapterNumber],
    );
    const [fetchPages, pagesResponse] = requestManager.useGetChapterPagesFetch(rawChapter?.id ?? -1);
    const pages = rawChapter ? (pagesResponse.data?.fetchChapterPages?.pages ?? []) : [];

    useEffect(() => {
        if (rawChapter) {
            fetchPages({ variables: { input: { chapterId: rawChapter.id } } }).catch(
                defaultPromiseErrorHandler('ComparePane::fetchPages'),
            );
        }
    }, [rawChapter?.id]);

    const sync = useCallback(() => {
        const scrollElement = scrollElementRef.current;
        const pane = paneRef.current;
        const chapter = scrollElement ? measureChapter(chapterId, scrollElement) : null;
        if (!scrollElement || !pane || !chapter) {
            return;
        }
        const fraction = getChapterFraction({
            scrollTop: scrollElement.scrollTop,
            viewportHeight: scrollElement.clientHeight,
            chapterTop: chapter.top,
            chapterBottom: chapter.bottom,
        });
        pane.scrollTop = getPaneScrollTop(fraction, pane.scrollHeight, pane.clientHeight);
        pane.dataset.fraction = fraction.toFixed(3);
    }, [chapterId, scrollElementRef]);

    useEffect(() => {
        const scrollElement = scrollElementRef.current;
        sync();
        scrollElement?.addEventListener('scroll', sync, { passive: true });
        return () => scrollElement?.removeEventListener('scroll', sync);
    }, [sync, scrollElementRef]);

    const notice = (() => {
        if (rawChapter === null) {
            return t`No raw chapter ${chapterNumber}`;
        }
        if (rawChapters === undefined || pagesResponse.loading) {
            return t`Loading raw…`;
        }
        if (pagesResponse.error) {
            return t`Couldn't load the raw chapter.`;
        }
        return null;
    })();

    return (
        <Box
            ref={paneRef}
            role="region"
            aria-label={t`Raw chapter`}
            data-raw-chapter={rawChapter?.id ?? ''}
            onClick={(event) => event.stopPropagation()}
            sx={{
                position: 'fixed',
                top: 0,
                right: 0,
                width: '50vw',
                height: '100vh',
                overflow: 'hidden',
                bgcolor: 'background.default',
                borderLeft: 1,
                borderColor: 'divider',
                zIndex: 1,
            }}
        >
            {notice && (
                <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
                    {notice}
                </Typography>
            )}
            {pages.map((url, index) => (
                <RawImage
                    // oxlint-disable-next-line react/no-array-index-key
                    key={index}
                    src={`${requestManager.getBaseUrl()}${url}`}
                    alt={t`Raw page ${index + 1}`}
                    onLoad={sync}
                    draggable={false}
                />
            ))}
        </Box>
    );
};

/** Whether the reader is at the end of the current chapter (vertical: 90 % scrolled; paged: its last page). */
const useIsAtChapterEnd = (scrollElementRef: ScrollElementRef, isVertical: boolean) => {
    const currentChapter = useReaderChaptersStore('currentChapter');
    const { currentPageIndex, totalPages } = useReaderPagesStore('currentPageIndex', 'totalPages');
    const [fraction, setFraction] = useState(0);

    useEffect(() => {
        const scrollElement = scrollElementRef.current;
        if (!scrollElement || !currentChapter || !isVertical) {
            return undefined;
        }
        const update = () => {
            const chapter = measureChapter(currentChapter.id, scrollElement);
            if (chapter) {
                setFraction(
                    getChapterFraction({
                        scrollTop: scrollElement.scrollTop,
                        viewportHeight: scrollElement.clientHeight,
                        chapterTop: chapter.top,
                        chapterBottom: chapter.bottom,
                    }),
                );
            }
        };
        update();
        scrollElement.addEventListener('scroll', update, { passive: true });
        return () => scrollElement.removeEventListener('scroll', update);
    }, [scrollElementRef, currentChapter?.id, isVertical]);

    return isVertical ? fraction >= END_FRACTION : totalPages > 0 && currentPageIndex >= totalPages - 1;
};

const FloatingCard = ({ isShown, children }: { isShown: boolean; children: ReactNode }) => (
    <Paper
        elevation={6}
        onClick={(event) => event.stopPropagation()}
        role="status"
        sx={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2,
            p: 1.5,
            maxWidth: 'calc(100vw - 32px)',
            // Kept mounted while hidden: a translation requested here keeps being followed.
            display: isShown ? undefined : 'none',
        }}
    >
        {children}
    </Paper>
);

/** The reader's series around the English one: the English reader itself, or an MTL series it translates. */
const useReaderSeries = () => {
    const manga = useReaderStore('manga');
    const parentId = useMtlParent(manga);
    const parent = requestManager.useGetManga<GetMangaMetaQuery, GetMangaMetaQueryVariables>(
        GET_MANGA_META,
        parentId ?? -1,
        { skip: !parentId },
    ).data?.manga;
    const series = useSeriesMtl(parentId ? parent : manga);
    const role = (() => {
        if (!series || !manga) {
            return null;
        }
        if (parentId && series.enId === parentId) {
            return 'mtl';
        }
        return series.enId === manga.id ? 'english' : null;
    })();
    return { manga, series, role } as const;
};

/** One chapter per number (the first by source order). */
const firstByNumber = (chapters: SeriesChapter[]) => {
    const byNumber = new Map<number, SeriesChapter>();
    [...chapters]
        .sort((a, b) => a.sourceOrder - b.sourceOrder)
        .forEach((chapter) => {
            if (chapter.chapterNumber >= 0 && !byNumber.has(chapter.chapterNumber)) {
                byNumber.set(chapter.chapterNumber, chapter);
            }
        });
    return byNumber;
};

/**
 * Next / Previous across the series: the English reader gets the MTL chapters English lacks in the scanlator filter, the
 * MTL reader the English chapters in it; either way the foreign chapter wins a tie.
 */
const useForeignChapters = ({ manga, series, role }: ReturnType<typeof useReaderSeries>) => {
    useEffect(() => {
        if (!manga || !series || !role) {
            clearForeignChapters();
            return;
        }
        if (role === 'english') {
            setForeignChapters(
                manga.id,
                [...series.mtlByNumber.entries()]
                    .filter(([number]) => !series.englishNumbers.has(number))
                    .map(([number, chapter]) => ({ number, path: Chapters.getReaderUrl(chapter) })),
                // A tie is an English copy outside the scanlator filter: the MTL chapter comes first.
                true,
            );
            return;
        }
        setForeignChapters(
            manga.id,
            [...firstByNumber(series.english).entries()].map(([number, chapter]) => ({
                number,
                path: Chapters.getReaderUrl(chapter),
            })),
            true,
        );
    }, [manga?.id, series, role]);

    useEffect(() => () => clearForeignChapters(), []);
};

/** MTL chapter still being translated: a note at its end, and the full page list once it is in. */
const PartialChapterNote = ({
    series,
    isAtEnd,
    scrollElementRef,
    isVertical,
}: {
    series: SeriesMtl;
    isAtEnd: boolean;
    scrollElementRef: ScrollElementRef;
    isVertical: boolean;
}) => {
    const { t } = useLingui();
    const currentChapter = useReaderChaptersStore('currentChapter');
    const number = currentChapter?.chapterNumber ?? -1;
    const engine = useMtlChapter(number >= 0 ? getMtlRef(series, number) : null);
    const wasPartial = useRef(false);
    const { status } = engine;
    const isPartial = status?.state === 'partial' || (status?.state === 'running' && !!status.path);

    useEffect(() => {
        if (isPartial) {
            wasPartial.current = true;
        }
        if (status?.state === 'ready' && wasPartial.current && currentChapter) {
            wasPartial.current = false;
            refetchChapterPagesInPlace({
                chapterId: currentChapter.id,
                scrollElement: scrollElementRef.current,
                isVertical,
            });
        }
    }, [isPartial, status?.state, currentChapter?.id]);

    if (!isPartial || (status.state !== 'partial' && status.state !== 'running')) {
        return null;
    }
    const ready = status.pagesReady ?? 0;
    const total = status.pagesTotal ?? 0;
    const from = ready + 1;

    return (
        <FloatingCard isShown={isAtEnd}>
            <Typography variant="body2">
                {total
                    ? t`Pages ${from}-${total} are still being translated… (${ready} / ${total})`
                    : t`The rest of this chapter is still being translated…`}
            </Typography>
        </FloatingCard>
    );
};

/** End of the MTL chapter when English has the next one: Next goes there. */
const NextInEnglishNote = ({ isAtEnd }: { isAtEnd: boolean }) => {
    const { t } = useLingui();
    const { hasNext } = useTsujiForeignTargets();

    if (!hasNext) {
        return null;
    }

    return (
        <FloatingCard isShown={isAtEnd}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
                <Typography variant="body2">{t`The next chapter is in English.`}</Typography>
                <Button variant="contained" size="small" onClick={() => tsujiOpenForeignChapter('next')}>
                    {t`Next chapter`}
                </Button>
            </Stack>
        </FloatingCard>
    );
};

/**
 * The next number has no English chapter in the filter, and the raw or the MTL has it. In the MTL reader only when
 * the MTL doesn't have it yet either (its own Next goes there otherwise).
 */
export const getEndOfEnglishNumber = (
    series: SeriesMtl | null,
    chapterNumber: number | undefined,
    role: 'english' | 'mtl' | null,
): number | null => {
    if (!role || !series?.isLoaded || chapterNumber === undefined || chapterNumber < 0) {
        return null;
    }
    const next = Math.floor(chapterNumber) + 1;
    if (series.englishNumbers.has(next) || (role === 'mtl' && series.mtlByNumber.has(next))) {
        return null;
    }
    return series.rawByNumber.has(next) || series.mtlByNumber.has(next) ? next : null;
};

/** How often the next chapter's engine state is asked while the reader sits at a chapter's end. */
const READ_AHEAD_CHECK_MS = 15_000;

/**
 * MTL read-ahead: once a chapter is read the engine translates the next raw chapter by itself, after the reader loaded
 * its lists. While the reader is at the end of a chapter whose next number neither English nor the MTL list has (the
 * raw has it), the engine is asked about it every 15 s (polled every 3 s once queued); as soon as it is readable the
 * MTL list is fetched again, so Next, the inline rows and the card see the chapter translated ahead.
 */
const useReadAhead = (
    series: SeriesMtl | null,
    chapter: { id: number; chapterNumber: number } | null | undefined,
    isAtEnd: boolean,
) => {
    const next = chapter && chapter.chapterNumber >= 0 ? Math.floor(chapter.chapterNumber) + 1 : null;
    const isMissing =
        !!series?.isLoaded &&
        next !== null &&
        !series.englishNumbers.has(next) &&
        !series.mtlByNumber.has(next) &&
        series.rawByNumber.has(next);
    const ref = isMissing && series && next !== null ? getMtlRef(series, next) : null;
    const engine = useMtlChapter(ref);
    const readablePath = getReadablePath(engine.status);
    const refreshedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isAtEnd || !ref) {
            return undefined;
        }
        const timer = setInterval(() => {
            const { status, error } = getMtlEntry(getMtlKey(ref));
            if (!error && !isMtlPending(status) && !getReadablePath(status)) {
                fetchMtlStatus(ref);
            }
        }, READ_AHEAD_CHECK_MS);
        return () => clearInterval(timer);
    }, [isAtEnd, ref ? getMtlKey(ref) : '']);

    useEffect(() => {
        const key = `${next}|${readablePath}`;
        if (!readablePath || !series?.mtlId || refreshedRef.current === key) {
            return;
        }
        refreshedRef.current = key;
        refreshMangaChapters(series.mtlId);
    }, [readablePath, next, series?.mtlId]);
};

/**
 * Reader layer of briefs #6 and #19 (mounted once by ReaderViewer): the Compare pane while Compare is on; at the end of
 * a chapter whose next number isn't in English (nor, in the MTL reader, in the MTL), the "English ran out" card; on an
 * MTL chapter still being translated, its note; Next / Previous across the English and MTL series; and the MTL list
 * asked again at a chapter's end for what the engine translated ahead.
 */
export const TsujiReaderRawLayer = ({ scrollElementRef }: { scrollElementRef: ScrollElementRef }) => {
    const links = useReaderRawLinks();
    const reader = useReaderSeries();
    const isActive = useCompareStore((state) => state.isActive);
    const readingMode = useReaderSettingsStore('readingMode').value;
    const currentChapter = useReaderChaptersStore('currentChapter');
    const isVertical = isContinuousVerticalReadingMode(readingMode);
    const isAtEnd = useIsAtChapterEnd(scrollElementRef, isVertical);
    const { series, role } = reader;
    useForeignChapters(reader);

    useReadAhead(series, currentChapter, isAtEnd);
    const endNumber = getEndOfEnglishNumber(series, currentChapter?.chapterNumber, role);
    const isEndCardShown = endNumber !== null && isAtEnd;
    useEffect(() => {
        useEndCardStore.setState({ isShown: isEndCardShown });
    }, [isEndCardShown]);

    // Compare is per reader visit.
    useEffect(
        () => () => {
            setCompareActive(false);
            useEndCardStore.setState({ isShown: false });
        },
        [],
    );

    return (
        <>
            {isActive && isVertical && links.rawId && currentChapter && (
                <ComparePane
                    key={currentChapter.id}
                    rawId={links.rawId}
                    origin={links.row?.origin ?? null}
                    chapterId={currentChapter.id}
                    chapterNumber={currentChapter.chapterNumber}
                    scrollElementRef={scrollElementRef}
                />
            )}
            {series && endNumber !== null && currentChapter && (
                <FloatingCard key={`${currentChapter.id}-${endNumber}`} isShown={isEndCardShown}>
                    <EnglishRanOutPanel
                        series={series}
                        number={endNumber}
                        isShown={isEndCardShown}
                        isInReader
                        onCompare={isVertical && series.rawId ? () => setCompareActive(true) : undefined}
                    />
                </FloatingCard>
            )}
            {series && role === 'mtl' && (
                <PartialChapterNote
                    series={series}
                    isAtEnd={isAtEnd}
                    scrollElementRef={scrollElementRef}
                    isVertical={isVertical}
                />
            )}
            {role === 'mtl' && endNumber === null && <NextInEnglishNote isAtEnd={isAtEnd} />}
        </>
    );
};
