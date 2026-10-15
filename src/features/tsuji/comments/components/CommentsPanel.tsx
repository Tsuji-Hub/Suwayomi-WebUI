/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useMemo, useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { makeToast } from '@/base/utils/Toast.ts';
import type { SeriesCandidate } from '@/features/tsuji/comments/CommentSource.ts';
import { CommentMatchesFullError } from '@/features/tsuji/comments/commentsMatch.ts';
import { comickSource } from '@/features/tsuji/comments/commentsService.ts';
import type { CommentsState } from '@/features/tsuji/comments/useComments.ts';
import { useComments } from '@/features/tsuji/comments/useComments.ts';
import { CommentItem } from '@/features/tsuji/comments/components/CommentItem.tsx';
import { formatChapterNumber } from '@/features/tsuji/progress/progress.ts';
import type { CommentChapter } from '@/features/tsuji/comments/chapterNav.ts';
import { getChapterLabel, getChapterStep } from '@/features/tsuji/comments/chapterNav.ts';
import { ChapterPicker } from '@/features/tsuji/comments/components/ChapterPicker.tsx';

/** Drawer on the right from this width, bottom sheet below. */
const DESKTOP_QUERY = '(min-width: 900px)';
const PAGE_SIZE = 50;

export type CommentsTarget = { manga: { id: number; title: string }; chapterNumber: number };

type SearchState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'unreachable' }
    | { status: 'done'; results: SeriesCandidate[] };

/** Manual match: search Comick by any title and pick the series; stored in `tsuji_commentsMatch`. */
const SeriesSearch = ({
    initialQuery,
    onPick,
    onCancel,
}: {
    initialQuery: string;
    onPick: (candidate: SeriesCandidate) => void;
    onCancel?: () => void;
}) => {
    const { t } = useLingui();
    const [query, setQuery] = useState(initialQuery);
    const [search, setSearch] = useState<SearchState>({ status: 'idle' });
    const [controller, setController] = useState<AbortController | null>(null);

    useEffect(() => () => controller?.abort(), [controller]);

    const run = () => {
        const trimmed = query.trim();
        if (!trimmed) {
            return;
        }
        const next = new AbortController();
        setController(next);
        setSearch({ status: 'loading' });
        comickSource
            .searchSeries(trimmed, next.signal)
            .then((results) => !next.signal.aborted && setSearch({ status: 'done', results }))
            .catch(() => !next.signal.aborted && setSearch({ status: 'unreachable' }));
    };

    return (
        <Stack sx={{ gap: 1 }}>
            <Stack
                component="form"
                direction="row"
                sx={{ gap: 1, alignItems: 'center' }}
                onSubmit={(event) => {
                    event.preventDefault();
                    run();
                }}
            >
                <TextField
                    size="small"
                    fullWidth
                    label={t`Search Comick`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.stopPropagation()}
                />
                <Button type="submit" variant="outlined" disabled={search.status === 'loading'}>
                    {t`Search`}
                </Button>
            </Stack>
            {onCancel && (
                <Button size="small" onClick={onCancel} sx={{ alignSelf: 'flex-start' }}>
                    {t`Cancel`}
                </Button>
            )}
            {search.status === 'loading' && <CircularProgress size={20} sx={{ alignSelf: 'center' }} />}
            {search.status === 'unreachable' && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`Comments relay unreachable`}
                </Typography>
            )}
            {search.status === 'done' && !search.results.length && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`No results.`}
                </Typography>
            )}
            {search.status === 'done' && !!search.results.length && (
                <List dense disablePadding aria-label={t`Comick results`}>
                    {search.results.map((candidate) => (
                        <ListItemButton key={candidate.seriesKey} onClick={() => onPick(candidate)}>
                            <ListItemText
                                primary={candidate.title || candidate.seriesKey}
                                secondary={t`${Math.round(candidate.score * 100)}% title match`}
                            />
                        </ListItemButton>
                    ))}
                </List>
            )}
        </Stack>
    );
};

const Notice = ({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) => (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {text}
        </Typography>
        {action && (
            <Button size="small" onClick={action.onClick}>
                {action.label}
            </Button>
        )}
    </Stack>
);

const CommentList = ({ state }: { state: Extract<CommentsState, { status: 'ready' }> }) => {
    const { t } = useLingui();
    const [shown, setShown] = useState(PAGE_SIZE);
    const { comments } = state;

    if (!comments.length) {
        return <Notice text={t`No comments yet.`} />;
    }

    return (
        <Stack sx={{ gap: 2 }}>
            {comments.slice(0, shown).map((comment) => (
                <CommentItem key={comment.id} comment={comment} />
            ))}
            {comments.length > shown && (
                <Button onClick={() => setShown((count) => count + PAGE_SIZE)}>
                    {t`Show more (${comments.length - shown})`}
                </Button>
            )}
        </Stack>
    );
};

const PanelBody = ({ target }: { target: CommentsTarget }) => {
    const { t } = useLingui();
    const { state, retry, setManualMatch } = useComments({ ...target, isActive: true });
    const [isSearching, setIsSearching] = useState(false);
    const chapter = formatChapterNumber(target.chapterNumber);

    useEffect(() => setIsSearching(false), [target.manga.id]);

    const pick = (candidate: SeriesCandidate | null) => {
        setManualMatch(candidate?.seriesKey ?? null)
            .then(() => setIsSearching(false))
            .catch((error) =>
                makeToast(
                    error instanceof CommentMatchesFullError
                        ? t`Too many manual matches saved. Remove some in Discover settings.`
                        : t`Couldn't save the match. Check the connection to the server.`,
                    'error',
                ),
            );
    };

    if (state.status === 'off') {
        return <Notice text={t`Comments are off. Turn them on in Discover settings.`} />;
    }
    if (state.status === 'loading') {
        return <CircularProgress size={24} sx={{ alignSelf: 'center', my: 4 }} aria-label={t`Loading comments`} />;
    }
    if (state.status === 'unreachable') {
        return <Notice text={t`Comments relay unreachable`} action={{ label: t`Retry`, onClick: retry }} />;
    }
    if (state.status === 'no-match') {
        return (
            <Stack sx={{ gap: 2 }}>
                <Notice text={t`No Comick thread for this series`} />
                <SeriesSearch initialQuery={target.manga.title} onPick={pick} />
            </Stack>
        );
    }

    const matchLine = (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {state.isManual ? t`Comick, matched by hand` : t`Comick: ${state.match.title}`}
            </Typography>
            <Link component="button" variant="caption" onClick={() => setIsSearching((value) => !value)}>
                {t`Wrong series?`}
            </Link>
            {state.isManual && (
                <Link component="button" variant="caption" onClick={() => pick(null)}>
                    {t`Use automatic match`}
                </Link>
            )}
        </Stack>
    );

    return (
        <Stack sx={{ gap: 2 }}>
            {matchLine}
            {isSearching && (
                <SeriesSearch initialQuery={target.manga.title} onPick={pick} onCancel={() => setIsSearching(false)} />
            )}
            {state.status === 'no-thread' ? (
                <Notice text={t`Comick has no thread for chapter ${chapter}`} />
            ) : (
                <>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {plural(state.comments.length, { one: '# comment', other: '# comments' })}
                    </Typography>
                    <Divider />
                    <CommentList key={state.thread.threadKey} state={state} />
                </>
            )}
        </Stack>
    );
};

/** 40 px tap targets whatever the root font size. */
const ARROW_SX = { width: 40, height: 40 };

const isTextField = (element: EventTarget) =>
    element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/** < Ch. 75 - Title > under the title: steps through chapter numbers; the label opens the picker. */
const ChapterSelector = ({
    chapters,
    current,
    isDesktop,
    onChange,
}: {
    chapters: CommentChapter[];
    current: number;
    isDesktop: boolean;
    onChange: (chapterNumber: number) => void;
}) => {
    const { t } = useLingui();
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const previous = getChapterStep(chapters, current, -1);
    const next = getChapterStep(chapters, current, 1);

    return (
        <Stack direction="row" sx={{ alignItems: 'center', minWidth: 0 }}>
            <IconButton
                aria-label={t`Previous chapter`}
                disabled={previous === null}
                onClick={() => previous !== null && onChange(previous)}
                sx={ARROW_SX}
            >
                <ChevronLeftIcon />
            </IconButton>
            <Button
                onClick={() => setIsPickerOpen(true)}
                disabled={!chapters.length}
                aria-label={t`Choose chapter`}
                aria-haspopup="dialog"
                sx={{ minWidth: 0, flex: 1, textTransform: 'none', justifyContent: 'center' }}
            >
                <Typography variant="body2" noWrap component="span">
                    {getChapterLabel(chapters, current)}
                </Typography>
            </Button>
            <IconButton
                aria-label={t`Next chapter`}
                disabled={next === null}
                onClick={() => next !== null && onChange(next)}
                sx={ARROW_SX}
            >
                <ChevronRightIcon />
            </IconButton>
            {isPickerOpen && (
                <ChapterPicker
                    chapters={chapters}
                    current={current}
                    isOpen={isPickerOpen}
                    isDesktop={isDesktop}
                    onClose={() => setIsPickerOpen(false)}
                    onPick={(chapterNumber) => {
                        setIsPickerOpen(false);
                        onChange(chapterNumber);
                    }}
                />
            )}
        </Stack>
    );
};

/**
 * Header (title, chapter selector, close) and the selected chapter's thread. Mounted only while the panel is open,
 * so every open starts on the entry point's chapter (the selector's choice is not kept).
 */
const PanelContent = ({
    target,
    chapters,
    isDesktop,
    onClose,
}: {
    target: CommentsTarget;
    chapters: CommentChapter[];
    isDesktop: boolean;
    onClose: () => void;
}) => {
    const { t } = useLingui();
    const [chapterNumber, setChapterNumber] = useState(target.chapterNumber);
    const selected = useMemo(() => ({ ...target, chapterNumber }), [target, chapterNumber]);

    const onKeyDown = (event: React.KeyboardEvent) => {
        // Escape belongs to the drawer (and the picker); every other key stays in the panel, so the reader's
        // hotkeys (arrows, space) don't turn pages behind it.
        if (event.key === 'Escape') {
            return;
        }
        event.stopPropagation();
        const isOwnKey = event.currentTarget.contains(event.target as Node) && !isTextField(event.target);
        if (!isOwnKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
            return;
        }
        const step = getChapterStep(chapters, chapterNumber, event.key === 'ArrowLeft' ? -1 : 1);
        event.preventDefault();
        if (step !== null) {
            setChapterNumber(step);
        }
    };

    return (
        <Stack sx={{ height: '100%', minHeight: 0 }} onKeyDown={onKeyDown}>
            <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1, px: 2, pt: 1.5, pb: 0.5 }}>
                <Stack sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="h6" component="h2">
                        {t`Comments`}
                    </Typography>
                    <ChapterSelector
                        chapters={chapters}
                        current={chapterNumber}
                        isDesktop={isDesktop}
                        onChange={setChapterNumber}
                    />
                </Stack>
                <IconButton onClick={onClose} aria-label={t`Close`}>
                    <CloseIcon />
                </IconButton>
            </Stack>
            <Divider />
            <Stack key={chapterNumber} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
                <PanelBody target={selected} />
            </Stack>
        </Stack>
    );
};

/**
 * The one comments panel (series view and reader): a drawer on the right on wide screens, a bottom sheet under
 * 900 px. Read-only, one chapter at a time: the selector moves between chapters, nothing is fetched for chapters
 * that aren't selected.
 */
export const CommentsPanel = ({
    target,
    chapters,
    isOpen,
    onClose,
}: {
    target: CommentsTarget;
    /** The manga's chapters, one per number (`buildCommentChapters`); empty disables the selector. */
    chapters: CommentChapter[];
    isOpen: boolean;
    onClose: () => void;
}) => {
    const { t } = useLingui();
    const isDesktop = useMediaQuery(DESKTOP_QUERY);

    return (
        <Drawer
            anchor={isDesktop ? 'right' : 'bottom'}
            open={isOpen}
            onClose={onClose}
            slotProps={{
                paper: {
                    role: 'dialog',
                    'aria-label': t`Comments`,
                    // The reader toggles its overlay on clicks: keep the panel's own clicks to itself.
                    onClick: (event: React.MouseEvent) => event.stopPropagation(),
                    sx: isDesktop
                        ? { width: 420, maxWidth: '100vw' }
                        : { height: '85vh', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
                },
            }}
        >
            <PanelContent
                key={`${target.manga.id}:${target.chapterNumber}`}
                target={target}
                chapters={chapters}
                isDesktop={isDesktop}
                onClose={onClose}
            />
        </Drawer>
    );
};
