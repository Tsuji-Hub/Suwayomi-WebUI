/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';
import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import { TSUJI_PALETTE } from '@/features/tsuji/Tsuji.palette.ts';
import { formatChapterNumber } from '@/features/tsuji/progress/progress.ts';
import { useMangaProgress } from '@/features/tsuji/progress/useMangaProgress.ts';
import type { DropBand, DropData, DropMap, DropNote } from '@/features/tsuji/drops/drops.ts';
import {
    formatDropPct,
    getDropSummary,
    getMarkerFraction,
    getPeerRank,
    isCliffBucket,
    isMapUsable,
    ON_HOLD_MARGIN,
    resolveDropBand,
    splitNotes,
} from '@/features/tsuji/drops/drops.ts';
import { useDropIndex, useSeriesDrops } from '@/features/tsuji/drops/dropService.ts';
import { useMangaAniListId } from '@/features/tsuji/drops/useMangaAniListId.ts';
import { DROP_BAND_COLOR } from '@/features/tsuji/drops/components/dropColors.ts';

const STRIP_HEIGHT = 44;

const formatCount = (count: number) => count.toLocaleString();

/** Ongoing on AniList (the "stopped when caught up" share replaces "finished"). */
const isOngoing = (status: string | null) => status === 'RELEASING' || status === 'HIATUS';

/**
 * "3.2 % dropped · low for ongoing manhwa" (v6: the server's label against the title's peers, with how it ranks; an
 * older server: low / typical / high vs the library median), then "58 % finished · 4 % on hold" ("41 % stopped when
 * caught up" for an ongoing series) and the on-hold range when it matters.
 */
const RateLine = ({ data, band }: { data: DropData; band: DropBand | null }) => {
    const { t } = useLingui();
    const pct = formatDropPct(data.dropPct);
    const dropped = formatCount(data.dropped);
    const started = formatCount(data.started);
    const finished = Math.round(data.completePct);
    const onHold = Math.round(data.pausePct);
    const caughtUp = isOngoing(data.status) ? data.map?.caughtUpShare : null;
    const bandWord = (() => {
        switch (band) {
            case 'low':
                return t`low`;
            case 'high':
                return t`high`;
            case 'typical':
                return t`typical`;
            default:
                return null;
        }
    })();
    const { peer, pctile, peerN, peerMedian, ci, dropHi } = data;
    const bandLabel = bandWord && peer ? t`· ${bandWord} for ${peer}` : bandWord && `· ${bandWord}`;
    const peerTooltip = (() => {
        if (!band || !peer || pctile === null) {
            return '';
        }
        const { direction, share } = getPeerRank(pctile);
        let rank: string;
        if (peerN !== null) {
            rank =
                direction === 'lower'
                    ? t`Lower than ${share} % of ${peerN} ${peer} in your library`
                    : t`Higher than ${share} % of ${peerN} ${peer} in your library`;
        } else {
            rank =
                direction === 'lower'
                    ? t`Lower than ${share} % of ${peer} in your library`
                    : t`Higher than ${share} % of ${peer} in your library`;
        }
        const median = peerMedian !== null ? ` ${t`(median ${formatDropPct(peerMedian)} %)`}` : '';
        const range = ci ? ` ${t`95 % range ${formatDropPct(ci[0])}-${formatDropPct(ci[1])} %.`}` : '';
        return `${rank}${median}.${range}`;
    })();
    const onHoldRange =
        dropHi !== null && dropHi > data.dropPct + ON_HOLD_MARGIN
            ? ` ${t`(up to ${formatDropPct(dropHi)} % counting on-hold untouched 6+ months)`}`
            : '';
    const caughtUpPct = caughtUp != null ? Math.round(caughtUp) : null;

    return (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <CustomTooltip title={t`${dropped} of ${started} readers who started it (AniList)`}>
                <Chip
                    size="small"
                    variant="outlined"
                    label={t`${pct} % dropped`}
                    sx={band ? { borderColor: DROP_BAND_COLOR[band], color: DROP_BAND_COLOR[band] } : undefined}
                />
            </CustomTooltip>
            {bandLabel && (
                <CustomTooltip title={peerTooltip} disabled={!peerTooltip}>
                    <Typography variant="body2" sx={{ color: band ? DROP_BAND_COLOR[band] : undefined }}>
                        {bandLabel}
                    </Typography>
                </CustomTooltip>
            )}
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {caughtUpPct !== null
                    ? t`${caughtUpPct} % stopped when caught up · ${onHold} % on hold`
                    : t`${finished} % finished · ${onHold} % on hold`}
                {onHoldRange}
            </Typography>
        </Stack>
    );
};

/** One bar per bucket (height = droppers), cliffs in the warning colour, and a marker at the reader's chapter. */
const DropStrip = ({ map, readChapter }: { map: DropMap; readChapter: number | null }) => {
    const { t } = useLingui();
    const highest = Math.max(1, ...map.buckets.map(({ count }) => count));
    const marker = getMarkerFraction(map, readChapter);
    const first = map.buckets[0].from;
    const last = map.buckets.at(-1)!.to;
    const readLabel = readChapter !== null ? formatChapterNumber(readChapter) : '';

    return (
        <Stack sx={{ gap: 0.25 }}>
            <Box
                role="img"
                aria-label={t`Where readers dropped it, ch ${first} to ${last}`}
                sx={{ position: 'relative', height: STRIP_HEIGHT, display: 'flex', alignItems: 'flex-end', gap: '2px' }}
            >
                {map.buckets.map((bucket) => {
                    const { from, to, count } = bucket;
                    return (
                        <CustomTooltip key={from} title={t`Ch ${from}-${to}: ${count} drops`}>
                            <Box
                                data-cliff={isCliffBucket(bucket, map.cliffs) || undefined}
                                sx={{
                                    flex: 1,
                                    minWidth: 2,
                                    height: `${Math.max(4, (100 * count) / highest)}%`,
                                    borderRadius: '2px 2px 0 0',
                                    bgcolor: isCliffBucket(bucket, map.cliffs)
                                        ? TSUJI_PALETTE.dropCliff
                                        : 'action.disabled',
                                }}
                            />
                        </CustomTooltip>
                    );
                })}
                {marker !== null && (
                    <CustomTooltip title={t`You: ch ${readLabel}`}>
                        <Box
                            aria-label={t`You: ch ${readLabel}`}
                            data-marker={marker.toFixed(3)}
                            sx={{
                                position: 'absolute',
                                top: -4,
                                bottom: 0,
                                left: `${marker * 100}%`,
                                width: 2,
                                ml: '-1px',
                                bgcolor: 'primary.main',
                            }}
                        />
                    </CustomTooltip>
                )}
            </Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t`ch ${first}`}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t`ch ${last}`}
                </Typography>
            </Stack>
        </Stack>
    );
};

/** v6: "26 % quit before ch 1", from 10 %. */
const ZERO_SHARE_MIN = 10;

const useZeroShareText = () => {
    const { t } = useLingui();
    return (map: DropMap | null) => {
        const share = map?.zeroShare;
        return share != null && share >= ZERO_SHARE_MIN ? t`${Math.round(share)} % quit before ch 1` : null;
    };
};

const MapSummary = ({ map }: { map: DropMap }) => {
    const getZeroShareText = useZeroShareText();
    const { t } = useLingui();
    const { cliffs, early, median } = getDropSummary(map);
    const zero = getZeroShareText(map);
    const cliffText = cliffs
        .map(({ from, to, share }) => {
            const pct = Math.round(share);
            return t`ch ${from}-${to} (${pct} %)`;
        })
        .join(t` and `);
    const parts = [
        cliffText && t`Most drops: ${cliffText}`,
        zero,
        early && t`${early.share} % quit in ch ${early.from}-${early.to}`,
        median !== null && t`half of droppers quit by ch ${median}`,
    ].filter(Boolean);
    const { n, nProgress } = map;
    const score = map.dropperScore !== null ? Math.round(map.dropperScore) : null;

    return (
        <Stack sx={{ gap: 0.25 }}>
            {!!parts.length && <Typography variant="body2">{parts.join(' · ')}</Typography>}
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t`Based on the latest ${n} public AniList drops (${nProgress} with progress)`}
                {score !== null && ` · ${t`Droppers rated it ${score}/100`}`}
            </Typography>
        </Stack>
    );
};

/** A note; a translated one says so, and "translated" shows the reader's own words (and back). */
const NoteLine = ({ note }: { note: DropNote }) => {
    const { t } = useLingui();
    const [isOriginal, setIsOriginal] = useState(false);
    const { ch, orig } = note;
    return (
        <Typography variant="body2">
            <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>
                {ch !== null ? t`ch ${ch}` : t`ch ?`}
                {orig !== null && (
                    <>
                        {' · '}
                        <Box
                            component="button"
                            type="button"
                            onClick={() => setIsOriginal(!isOriginal)}
                            aria-pressed={isOriginal}
                            title={isOriginal ? t`Show the English translation` : t`Show the original`}
                            sx={{
                                p: 0,
                                border: 0,
                                background: 'none',
                                font: 'inherit',
                                color: 'inherit',
                                cursor: 'pointer',
                                textDecoration: 'underline dotted',
                            }}
                        >
                            {t`translated`}
                        </Box>
                    </>
                )}
            </Box>
            {orig !== null && isOriginal ? orig : note.text}
        </Typography>
    );
};

/** Reader notes, collapsed; those past the reader's chapter stay blurred until asked (they can spoil). */
const DropNotes = ({ notes, readChapter }: { notes: DropNote[]; readChapter: number | null }) => {
    const { t } = useLingui();
    const [isOpen, setIsOpen] = useState(false);
    const [isAheadShown, setIsAheadShown] = useState(false);
    const { safe, ahead } = splitNotes(notes, readChapter);
    const count = notes.length;
    const read = readChapter !== null ? formatChapterNumber(readChapter) : null;

    return (
        <Stack sx={{ gap: 0.5 }}>
            <Button
                size="small"
                sx={{ alignSelf: 'flex-start' }}
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                {isOpen ? t`Hide reader notes` : t`Reader notes (${count}, may spoil)`}
            </Button>
            <Collapse in={isOpen} unmountOnExit>
                <Stack sx={{ gap: 0.5 }}>
                    {safe.map((note) => (
                        <NoteLine key={`${note.ch}-${note.text}`} note={note} />
                    ))}
                    {!!ahead.length && (
                        <Stack sx={{ gap: 0.5, position: 'relative' }}>
                            <Stack
                                aria-hidden={!isAheadShown}
                                sx={{
                                    gap: 0.5,
                                    ...(isAheadShown
                                        ? {}
                                        : { filter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none' }),
                                }}
                            >
                                {ahead.map((note) => (
                                    <NoteLine key={`${note.ch}-${note.text}`} note={note} />
                                ))}
                            </Stack>
                            {!isAheadShown && (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={() => setIsAheadShown(true)}
                                    sx={{ position: 'absolute', top: 0, left: 0 }}
                                >
                                    {read !== null && readChapter
                                        ? t`Show notes past ch ${read}`
                                        : t`Show notes (may spoil)`}
                                </Button>
                            )}
                        </Stack>
                    )}
                </Stack>
            </Collapse>
        </Stack>
    );
};

/**
 * Series page, under the buttons (brief #20): how many readers dropped it ("3.2 % dropped", low / typical / high vs the
 * library median), where they quit (a bar per chapter range, the pile-ups highlighted, a marker at the reader's
 * chapter), and their notes behind a spoiler guard. Hidden when there is no data; never blocks the page.
 */
export const ReadersBlock = ({ manga }: { manga: { id: number } & GqlMetaHolder }) => {
    const { t } = useLingui();
    const getZeroShareText = useZeroShareText();
    const anilistId = useMangaAniListId(manga);
    const drops = useSeriesDrops(anilistId);
    const index = useDropIndex(drops.status === 'ready');
    const progress = useMangaProgress(manga.id);

    if (drops.status !== 'ready') {
        return null;
    }
    const { data, isMapping } = drops;
    // Under 200 starters: the rate alone, no low / typical / high (the card chips' threshold).
    const band = resolveDropBand(data.label, data.dropPct, data.started, index?.medianDropPct);
    const readChapter = progress && progress.read > 0 ? progress.read : null;
    const { map } = data;
    const eta = Math.max(5, Math.round(map?.etaS ?? 30));

    return (
        <Paper variant="outlined" component="section" aria-label={t`Readers`} sx={{ p: 1.5 }}>
            <Stack sx={{ gap: 1 }}>
                <Typography variant="overline" sx={{ lineHeight: 1.5, color: 'text.secondary' }}>
                    {t`Readers`}
                </Typography>
                <RateLine data={data} band={band} />
                {isMapping && !isMapUsable(map) && (
                    <Stack direction="row" role="status" sx={{ alignItems: 'center', gap: 1 }}>
                        <CircularProgress size={14} />
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {t`Mapping where readers drop… ~${eta} s`}
                        </Typography>
                    </Stack>
                )}
                {isMapUsable(map) && (
                    <>
                        <DropStrip map={map} readChapter={readChapter} />
                        <MapSummary map={map} />
                    </>
                )}
                {!isMapping && map && map.state !== 'pending' && !isMapUsable(map) && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {[t`Not enough drops to map`, getZeroShareText(map)].filter(Boolean).join(' · ')}
                    </Typography>
                )}
                {!!data.notes.length && <DropNotes notes={data.notes} readChapter={readChapter} />}
            </Stack>
        </Paper>
    );
};
