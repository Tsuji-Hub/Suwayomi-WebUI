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
    getDropBand,
    getDropSummary,
    getMarkerFraction,
    isCliffBucket,
    isMapUsable,
    splitNotes,
} from '@/features/tsuji/drops/drops.ts';
import { useDropIndex, useSeriesDrops } from '@/features/tsuji/drops/dropService.ts';
import { useMangaAniListId } from '@/features/tsuji/drops/useMangaAniListId.ts';
import { DROP_BAND_COLOR } from '@/features/tsuji/drops/components/dropColors.ts';

const STRIP_HEIGHT = 44;

const formatCount = (count: number) => count.toLocaleString();

/** "3.2 % dropped" with how it compares to the library, and the finished / on hold shares. */
const RateLine = ({ data, band }: { data: DropData; band: DropBand | null }) => {
    const { t } = useLingui();
    const pct = formatDropPct(data.dropPct);
    const dropped = formatCount(data.dropped);
    const started = formatCount(data.started);
    const finished = Math.round(data.completePct);
    const onHold = Math.round(data.pausePct);
    const bandLabel = (() => {
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
                <Typography variant="body2" sx={{ color: band ? DROP_BAND_COLOR[band] : undefined }}>
                    {bandLabel}
                </Typography>
            )}
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t`${finished} % finished · ${onHold} % on hold`}
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

const MapSummary = ({ map }: { map: DropMap }) => {
    const { t } = useLingui();
    const { cliff, early, median } = getDropSummary(map);
    const parts = [
        cliff && t`Most drops: ch ${cliff.from}-${cliff.to} (${Math.round(cliff.share)} %)`,
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

const NoteLine = ({ note }: { note: DropNote }) => {
    const { t } = useLingui();
    const { ch } = note;
    return (
        <Typography variant="body2">
            <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>
                {ch !== null ? t`ch ${ch}` : t`ch ?`}
            </Box>
            {note.text}
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
    const anilistId = useMangaAniListId(manga);
    const drops = useSeriesDrops(anilistId);
    const index = useDropIndex(drops.status === 'ready');
    const progress = useMangaProgress(manga.id);

    if (drops.status !== 'ready') {
        return null;
    }
    const { data, isMapping } = drops;
    const band = getDropBand(data.dropPct, index?.medianDropPct);
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
                        {t`Not enough drops to map`}
                    </Typography>
                )}
                {!!data.notes.length && <DropNotes notes={data.notes} readChapter={readChapter} />}
            </Stack>
        </Paper>
    );
};
