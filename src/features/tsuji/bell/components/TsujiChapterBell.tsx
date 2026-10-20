/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { useLingui } from '@lingui/react/macro';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { AppRoutes } from '@/base/AppRoute.constants.ts';
import { ListCardAvatar } from '@/base/components/lists/cards/ListCardAvatar.tsx';
import { Chapters } from '@/features/chapter/services/Chapters.ts';
import type { BellCategory, BellEntry } from '@/features/tsuji/bell/chapterBell.ts';
import {
    formatBellCount,
    formatChapterRange,
    getRelativeTime,
    withTitleCount,
} from '@/features/tsuji/bell/chapterBell.ts';
import { useChapterBell } from '@/features/tsuji/bell/useChapterBell.ts';

const relativeTime = new Intl.RelativeTimeFormat(navigator.language, { numeric: 'auto' });

/** "(3) " in front of the page title while something is unseen; kept when the app changes the title. */
const useTitleCount = (count: number) => {
    useEffect(() => {
        const apply = () => {
            const next = withTitleCount(document.title, count);
            if (next !== document.title) {
                document.title = next;
            }
        };
        apply();
        const title = document.querySelector('title');
        const observer = title ? new MutationObserver(apply) : null;
        if (title) {
            observer?.observe(title, { childList: true, characterData: true, subtree: true });
        }
        return () => {
            observer?.disconnect();
            document.title = withTitleCount(document.title, 0);
        };
    }, [count]);
};

const BellSettingsDialog = ({
    categories,
    watched,
    onSave,
    onClose,
}: {
    categories: BellCategory[];
    watched: number[];
    onSave: (ids: number[]) => void;
    onClose: () => void;
}) => {
    const { t } = useLingui();
    const [selected, setSelected] = useState(() => new Set(watched));
    const toggle = (id: number) =>
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });

    return (
        <Dialog open onClose={onClose}>
            <DialogTitle>{t`Watched categories`}</DialogTitle>
            <DialogContent>
                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                    {t`New chapters of series you were caught up on in these categories show in the bell.`}
                </Typography>
                <Stack>
                    {categories
                        .filter(({ id }) => id !== 0)
                        .map(({ id, name }) => (
                            <FormControlLabel
                                key={id}
                                control={<Checkbox checked={selected.has(id)} onChange={() => toggle(id)} />}
                                label={name}
                            />
                        ))}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t`Cancel`}</Button>
                <Button
                    variant="contained"
                    onClick={() => {
                        onSave([...selected]);
                        onClose();
                    }}
                >
                    {t`Save`}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

const BellRow = ({
    entry,
    onOpen,
    onMarkSeen,
    onClose,
}: {
    entry: BellEntry;
    onOpen: (entry: BellEntry) => void;
    onMarkSeen: (entry: BellEntry) => void;
    onClose: () => void;
}) => {
    const { t } = useLingui();
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const range = formatChapterRange(entry.numbers);
    const count = entry.numbers.length;
    const { value, unit } = getRelativeTime(entry.newestFetchedAt, Date.now());

    return (
        <ListItem
            disablePadding
            secondaryAction={
                <IconButton
                    edge="end"
                    aria-label={t`More actions`}
                    onClick={(event: MouseEvent<HTMLElement>) => setMenuAnchor(event.currentTarget)}
                >
                    <MoreVertIcon />
                </IconButton>
            }
        >
            <ListItemButton onClick={() => onOpen(entry)} sx={{ gap: 1.5, pr: 6 }}>
                <ListCardAvatar
                    iconUrl={requestManager.getValidImgUrlFor(entry.thumbnailUrl ?? '')}
                    alt={entry.title}
                    slots={{ avatarProps: { sx: { width: 44, height: 60 } } }}
                />
                <Stack sx={{ minWidth: 0, gap: 0.25 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                        {entry.title}
                    </Typography>
                    <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip size="small" label={entry.category} />
                        <Typography variant="body2">
                            {count > 1 ? t`Ch ${range} · ${count} new` : t`Ch ${range}`}
                        </Typography>
                    </Stack>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {relativeTime.format(value, unit)}
                    </Typography>
                </Stack>
            </ListItemButton>
            <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
                <MenuItem
                    onClick={() => {
                        setMenuAnchor(null);
                        onMarkSeen(entry);
                    }}
                >
                    {t`Mark seen`}
                </MenuItem>
                <MenuItem
                    component={Link}
                    to={AppRoutes.manga.path(entry.mangaId)}
                    onClick={() => {
                        setMenuAnchor(null);
                        onClose();
                    }}
                >
                    {t`Open series`}
                </MenuItem>
            </Menu>
        </ListItem>
    );
};

/**
 * New-chapter bell in the app bar (brief #10): unseen entries as a badge, the list in a popover (a bottom sheet on
 * narrow screens). A row opens its first new chapter and marks the entry seen.
 */
export const TsujiChapterBell = () => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const isNarrow = useMediaQuery('(max-width: 599px)');
    const bell = useChapterBell();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const count = bell.unseen.length;
    const close = () => setAnchor(null);
    useTitleCount(count);

    const open = (entry: BellEntry) => {
        bell.markSeen([entry]);
        close();
        navigate(AppRoutes.reader.path(entry.mangaId, entry.firstChapter.sourceOrder), {
            state: Chapters.getReaderOpenChapterLocationState({ isRead: false }),
        });
    };

    const panel = (
        <Box sx={{ width: isNarrow ? '100%' : 400, maxHeight: isNarrow ? '80vh' : 520, overflowY: 'auto' }}>
            <Stack
                direction="row"
                sx={{ alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}
            >
                <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
                    {t`New chapters`}
                </Typography>
                <Button size="small" disabled={!count} onClick={() => bell.markSeen(bell.unseen)}>
                    {t`Mark all seen`}
                </Button>
                <IconButton size="small" aria-label={t`Bell settings`} onClick={() => setIsSettingsOpen(true)}>
                    <SettingsOutlinedIcon fontSize="small" />
                </IconButton>
            </Stack>
            {bell.isLoading && <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 3 }} />}
            {bell.isError && (
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1, p: 2 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {t`Couldn't load new chapters.`}
                    </Typography>
                    <Button size="small" onClick={() => bell.refresh()}>
                        {t`Retry`}
                    </Button>
                </Stack>
            )}
            {!bell.isLoading && !bell.isError && !count && (
                <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>
                    {t`Nothing new in the series you're caught up on.`}
                </Typography>
            )}
            {!!count && (
                <List dense aria-label={t`New chapters`}>
                    {bell.unseen.map((entry) => (
                        <BellRow
                            key={entry.mangaId}
                            entry={entry}
                            onOpen={open}
                            onMarkSeen={(seen) => bell.markSeen([seen])}
                            onClose={close}
                        />
                    ))}
                </List>
            )}
        </Box>
    );

    return (
        <>
            <IconButton
                color="inherit"
                aria-label={count ? t`New chapters: ${count}` : t`New chapters`}
                onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
            >
                <Badge badgeContent={formatBellCount(count)} color="error" invisible={!count}>
                    <NotificationsNoneOutlinedIcon />
                </Badge>
            </IconButton>
            {isNarrow ? (
                <Drawer anchor="bottom" open={!!anchor} onClose={close}>
                    {panel}
                </Drawer>
            ) : (
                <Popover
                    open={!!anchor}
                    anchorEl={anchor}
                    onClose={close}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                    {panel}
                </Popover>
            )}
            {isSettingsOpen && (
                <BellSettingsDialog
                    categories={bell.categories}
                    watched={bell.watchedCategoryIds}
                    onSave={bell.setWatchedCategories}
                    onClose={() => setIsSettingsOpen(false)}
                />
            )}
        </>
    );
};
