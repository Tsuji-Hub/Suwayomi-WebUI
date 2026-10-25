/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';
import { Chapters } from '@/features/chapter/services/Chapters.ts';
import { setCompareActive } from '@/features/tsuji/raws/compareStore.ts';
import { openSeriesChapter } from '@/features/tsuji/raws/mtlSequence.ts';
import { useMtlChapter } from '@/features/tsuji/raws/mtlEngine.ts';
import type { MtlStatus } from '@/features/tsuji/raws/mtlStatus.ts';
import {
    formatElapsed,
    formatNumber,
    getMangaIdFromPath,
    getReadablePath,
    getReaderAlignLine,
} from '@/features/tsuji/raws/mtlStatus.ts';
import type { SeriesMtl } from '@/features/tsuji/raws/useSeriesMtl.ts';
import { getMtlRef, refreshMangaChapters, rememberMtlSeries } from '@/features/tsuji/raws/useSeriesMtl.ts';

/** The English chapter just below `number` (Compare shows it next to its raw). */
const getEnglishBelow = (series: SeriesMtl, number: number) =>
    series.english
        .filter(({ chapterNumber }) => chapterNumber >= 0 && chapterNumber < number)
        .sort((a, b) => b.chapterNumber - a.chapterNumber || a.sourceOrder - b.sourceOrder)[0];

const ProgressLine = ({ status }: { status: MtlStatus }) => {
    const { t } = useLingui();

    if (status.state === 'queued') {
        const { position } = status;
        return (
            <Stack sx={{ gap: 0.5 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {position ? t`Queued (position ${position})…` : t`Queued…`}
                </Typography>
                <LinearProgress aria-label={t`Translation progress`} />
            </Stack>
        );
    }
    if (status.state !== 'running' && status.state !== 'partial') {
        return null;
    }
    const ready = status.pagesReady ?? 0;
    const total = status.pagesTotal ?? 0;
    const elapsed = status.state === 'running' && status.elapsed !== null ? formatElapsed(status.elapsed) : null;
    const pages = total ? t`${ready} / ${total} pages` : null;
    const stage = status.state === 'running' ? status.stage : '';
    const detail = [pages ?? stage, elapsed].filter(Boolean).join(' · ');

    return (
        <Stack sx={{ gap: 0.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {detail ? t`Translating… ${detail}` : t`Translating…`}
            </Typography>
            <LinearProgress
                aria-label={t`Translation progress`}
                variant={total ? 'determinate' : 'indeterminate'}
                value={total ? Math.min(100, (100 * ready) / total) : undefined}
            />
        </Stack>
    );
};

/**
 * "English ran out" (brief #19) for one chapter number: what the raw and the MTL have, the art-match line, and Translate
 * & read (queues it, then polls the engine every 3 s with a page counter), Read MTL / Read now, Read raw and Compare.
 * `isShown`: the user is still on it (a translation requested here then opens by itself when readable).
 */
export const EnglishRanOutPanel = ({
    series,
    number,
    variant = 'card',
    isShown = true,
    isInReader = false,
    onCompare,
}: {
    series: SeriesMtl;
    number: number;
    variant?: 'card' | 'row';
    isShown?: boolean;
    isInReader?: boolean;
    onCompare?: () => void;
}) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const rawChapter = series.rawByNumber.get(number);
    const mtlChapter = series.mtlByNumber.get(number);
    const ref = rawChapter ? getMtlRef(series, number) : null;
    const engine = useMtlChapter(ref);
    const [isRequestedHere, setIsRequestedHere] = useState(false);
    const hasAutoOpened = useRef(false);
    const label = formatNumber(number);
    const rawSource = series.links.raw?.source ?? '';

    const enginePath = getReadablePath(engine.status);
    const listPath = mtlChapter ? Chapters.getReaderUrl(mtlChapter) : null;
    const readPath = enginePath ?? listPath;
    const isPending = engine.status?.state === 'queued' || engine.status?.state === 'running';

    const open = async (path: string) => {
        const mangaId = getMangaIdFromPath(path);
        if (mangaId && mangaId !== series.rawId) {
            rememberMtlSeries(series.enId, mangaId);
            await refreshMangaChapters(mangaId);
        }
        openSeriesChapter(path, { replace: isInReader });
    };

    // Requested here and still on it: open as soon as the first part is readable.
    useEffect(() => {
        if (isRequestedHere && isShown && enginePath && !hasAutoOpened.current) {
            hasAutoOpened.current = true;
            open(enginePath);
        }
    }, [isRequestedHere, isShown, enginePath]);

    const compare =
        onCompare ??
        (() => {
            const english = getEnglishBelow(series, number);
            if (english) {
                setCompareActive(true);
                navigate(Chapters.getReaderUrl(english), {
                    state: Chapters.getReaderOpenChapterLocationState(english),
                });
            }
        });
    const canCompare = !!series.rawId && (!!onCompare || !!getEnglishBelow(series, number));

    const alignLine = getReaderAlignLine(series.links.align, number);
    const alignText = (() => {
        if (alignLine?.kind === 'follows') {
            const raw = formatNumber(alignLine.raw);
            const en = formatNumber(alignLine.en);
            const { source } = alignLine;
            return `✓ ${t`Raw ${raw} follows ${source} ${en} (art match)`}`;
        }
        return alignLine?.kind === 'warning' ? `⚠ ${alignLine.verdict}` : null;
    })();

    const primary = (() => {
        // The engine's link as soon as the first part is published; the MTL list's chapter unless one is on its way.
        if (readPath && (enginePath || !(isRequestedHere && isPending))) {
            return (
                <Button variant="contained" size="small" onClick={() => open(readPath)}>
                    {isRequestedHere ? t`Read now` : t`Read MTL ${label}`}
                </Button>
            );
        }
        if (ref && !isPending && engine.error !== 'refused' && engine.status) {
            return (
                <Button
                    variant="contained"
                    size="small"
                    disabled={engine.isRequesting}
                    onClick={() => {
                        setIsRequestedHere(true);
                        engine.request();
                    }}
                >
                    {t`Translate & read`}
                </Button>
            );
        }
        return null;
    })();

    return (
        <Stack
            role="group"
            aria-label={t`Chapter ${label}`}
            sx={{ gap: 1, minWidth: 0, ...(variant === 'row' ? { py: 1 } : { maxWidth: 420 }) }}
        >
            {variant === 'card' ? (
                <Typography variant="body2">
                    {rawChapter && rawSource
                        ? t`Ch ${label} isn't in English yet. Raw is out (${rawSource}).`
                        : t`Ch ${label} isn't in English yet.`}
                </Typography>
            ) : (
                <Typography variant="body2">{rawChapter ? t`Ch ${label}: raw is out` : t`Ch ${label}`}</Typography>
            )}
            {alignText && (
                <Typography
                    variant="caption"
                    sx={{ color: alignLine?.kind === 'follows' ? 'success.main' : 'warning.main' }}
                >
                    {alignText}
                </Typography>
            )}
            {engine.status && (isPending || (isRequestedHere && engine.status.state === 'partial')) && (
                <ProgressLine status={engine.status} />
            )}
            {engine.error === 'refused' && (
                <Typography variant="body2" sx={{ color: 'error.main' }}>
                    {t`Couldn't request a translation.`}
                </Typography>
            )}
            {engine.error === 'unreachable' && (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ color: 'error.main' }}>
                        {t`The MTL engine didn't answer.`}
                    </Typography>
                    <Button size="small" onClick={engine.retry}>
                        {t`Retry`}
                    </Button>
                </Stack>
            )}
            <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                {primary}
                {rawChapter && (
                    <Button size="small" variant="outlined" onClick={() => open(Chapters.getReaderUrl(rawChapter))}>
                        {t`Read raw`}
                    </Button>
                )}
                {canCompare && (
                    <Button size="small" onClick={compare}>
                        {t`Compare`}
                    </Button>
                )}
            </Stack>
        </Stack>
    );
};
