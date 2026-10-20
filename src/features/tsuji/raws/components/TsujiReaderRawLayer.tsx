/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
    useReaderSettingsStore,
    useReaderStore,
} from '@/features/reader/stores/ReaderStore.ts';
import { GET_CHAPTERS_MANGA } from '@/lib/graphql/chapter/ChapterQuery.ts';
import type { GetChaptersMangaQuery, GetChaptersMangaQueryVariables } from '@/lib/graphql/generated/graphql.ts';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { readTsujiMangaMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { measureChapter } from '@/features/tsuji/reader/chapterPagesRegistry.ts';
import { setCompareActive, useCompareStore } from '@/features/tsuji/raws/compareStore.ts';
import type { EndOffer } from '@/features/tsuji/raws/compareSync.ts';
import { getChapterFraction, getEndOffer, getPaneScrollTop } from '@/features/tsuji/raws/compareSync.ts';
import { getMangaIdFromUrl, parseRawLinks } from '@/features/tsuji/raws/rawLinks.ts';
import { useRawFeedRow } from '@/features/tsuji/raws/rawFeed.ts';
import { buildRawChapterMap } from '@/features/tsuji/raws/rawNumbering.ts';
import { TranslateDialog } from '@/features/tsuji/raws/components/TranslateDialog.tsx';

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

/** End of the newest English chapter: read the MTL chapter, or translate it (opens the server's page). */
const EndOfferCard = ({
    offer,
    onRead,
    onTranslate,
}: {
    offer: NonNullable<EndOffer>;
    onRead: () => void;
    onTranslate: () => void;
}) => {
    const { t } = useLingui();

    return (
        <Paper
            elevation={6}
            onClick={(event) => event.stopPropagation()}
            role="status"
            sx={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 2, p: 1.5 }}
        >
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
                <Typography variant="body2">{t`End of the English release.`}</Typography>
                {offer.kind === 'read' ? (
                    <Button variant="contained" size="small" onClick={onRead}>
                        {t`Read MTL ch ${offer.number}`}
                    </Button>
                ) : (
                    <Button variant="contained" size="small" onClick={onTranslate}>
                        {t`Translate ch ${offer.number}`}
                    </Button>
                )}
            </Stack>
        </Paper>
    );
};

const useEndOffer = (
    scrollElementRef: ScrollElementRef,
    { mtlId, row }: Pick<ReturnType<typeof useReaderRawLinks>, 'mtlId' | 'row'>,
) => {
    const currentChapter = useReaderChaptersStore('currentChapter');
    const nextChapter = useReaderChaptersStore('nextChapter');
    const mtlChapters = useMangaChapters(mtlId);
    const [fraction, setFraction] = useState(0);
    const isNewestChapter = !!currentChapter && !nextChapter;

    useEffect(() => {
        const scrollElement = scrollElementRef.current;
        if (!scrollElement || !currentChapter || !isNewestChapter) {
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
    }, [scrollElementRef, currentChapter?.id, isNewestChapter]);

    const mtlByNumber = useMemo(
        () =>
            new Map(
                (mtlChapters ?? [])
                    .filter(({ chapterNumber }) => chapterNumber >= 0)
                    .map((chapter) => [chapter.chapterNumber, chapter]),
            ),
        [mtlChapters],
    );
    const offer = getEndOffer({
        isNewestChapter,
        fraction,
        chapterNumber: currentChapter?.chapterNumber ?? -1,
        mtlNumbers: new Set(mtlByNumber.keys()),
        row,
    });

    return { offer, mtlChapter: offer?.kind === 'read' ? mtlByNumber.get(offer.number) : undefined };
};

/**
 * Reader layer of brief #6 (mounted once by ReaderViewer): the Compare pane while Compare is on, and the offer at
 * the end of the English release. Continuous vertical / webtoon only; nothing translates without a click.
 */
export const TsujiReaderRawLayer = ({ scrollElementRef }: { scrollElementRef: ScrollElementRef }) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const links = useReaderRawLinks();
    const isActive = useCompareStore((state) => state.isActive);
    const readingMode = useReaderSettingsStore('readingMode').value;
    const currentChapter = useReaderChaptersStore('currentChapter');
    const [dialogUrl, setDialogUrl] = useState<string | null>(null);
    const isVertical = isContinuousVerticalReadingMode(readingMode);
    const { offer, mtlChapter } = useEndOffer(scrollElementRef, links);

    // Compare is per reader visit.
    useEffect(() => () => setCompareActive(false), []);

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
            {isVertical && offer && (
                <EndOfferCard
                    offer={offer}
                    onRead={() => mtlChapter && navigate(Chapters.getReaderUrl(mtlChapter))}
                    onTranslate={() => offer.kind === 'translate' && setDialogUrl(offer.url)}
                />
            )}
            <TranslateDialog url={dialogUrl} title={t`Translate`} onClose={() => setDialogUrl(null)} />
        </>
    );
};
