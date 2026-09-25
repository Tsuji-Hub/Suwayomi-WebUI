/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import Badge from '@mui/material/Badge';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import FilterListIcon from '@mui/icons-material/FilterList';
import { useLingui } from '@lingui/react/macro';
import type { RecFilters } from '@/features/tsuji/recs/filters.ts';
import {
    COMIC_TYPES,
    countActiveFilters,
    DEFAULT_REC_FILTERS,
    MIN_CHAPTER_OPTIONS,
    MIN_SCORE_OPTIONS,
    REC_STATUSES,
} from '@/features/tsuji/recs/filters.ts';
import { COMIC_TYPE_LABELS, STATUS_BADGES } from '@/features/tsuji/recs/Recs.constants.ts';
import { setTriState, TriStateChip } from '@/features/tsuji/recs/components/TriStateChip.tsx';

/** Tags beyond this many (most common first) are left out of the popover to keep it scannable. */
const MAX_TAG_OPTIONS = 60;

const toggleInList = <T,>(list: T[], item: T): T[] =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];

export type SortOption = { value: string; label: string };

export const RecFilterBar = ({
    filters,
    onFiltersChange,
    sort,
    sortOptions,
    onSortChange,
    tagOptions,
    showHiddenGems = false,
}: {
    filters: RecFilters;
    onFiltersChange: (filters: RecFilters) => void;
    sort: string;
    sortOptions: SortOption[];
    onSortChange: (sort: string) => void;
    /** Similar only: tri-state tags built from the loaded recs. */
    tagOptions?: string[];
    showHiddenGems?: boolean;
}) => {
    const { t } = useLingui();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    const update = (partial: Partial<RecFilters>) => onFiltersChange({ ...filters, ...partial });
    // Hidden gems and tag filters only apply where their controls are shown (Similar).
    const activeCount = countActiveFilters({
        ...filters,
        hiddenGems: showHiddenGems && filters.hiddenGems,
        tags: tagOptions ? filters.tags : {},
    });
    // Active tag filters are saved globally: always list them first, even when this series' recs lack the tag.
    const activeTags = Object.keys(filters.tags);
    const visibleTagOptions = tagOptions
        ? [...activeTags, ...tagOptions.filter((name) => !(name in filters.tags))].slice(
              0,
              Math.max(MAX_TAG_OPTIONS, activeTags.length),
          )
        : [];

    return (
        <Stack direction="row" sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Select
                size="small"
                value={sort}
                onChange={(event) => onSortChange(event.target.value)}
                inputProps={{ 'aria-label': t`Sort` }}
            >
                {sortOptions.map(({ value, label }) => (
                    <MenuItem key={value} value={value}>
                        {label}
                    </MenuItem>
                ))}
            </Select>
            {showHiddenGems && (
                <FormControlLabel
                    control={
                        <Switch
                            size="small"
                            checked={filters.hiddenGems}
                            onChange={(_, checked) => update({ hiddenGems: checked })}
                        />
                    }
                    label={t`Hidden gems`}
                />
            )}
            <Badge badgeContent={activeCount} color="primary">
                <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FilterListIcon />}
                    onClick={(event) => setAnchor(event.currentTarget)}
                >
                    {t`Filters`}
                </Button>
            </Badge>
            <Popover
                open={!!anchor}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { sx: { p: 2, width: 360, maxWidth: 'calc(100vw - 32px)' } } }}
            >
                <Stack sx={{ gap: 1.5 }}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={filters.hideInLibrary}
                                onChange={(_, checked) => update({ hideInLibrary: checked })}
                            />
                        }
                        label={t`Hide titles in my library`}
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={filters.hideOnMyList}
                                onChange={(_, checked) => update({ hideOnMyList: checked })}
                            />
                        }
                        label={t`Hide what's on my AniList`}
                    />
                    <FormControlLabel
                        sx={{ ml: 3 }}
                        disabled={!filters.hideOnMyList}
                        control={
                            <Switch
                                size="small"
                                checked={filters.hidePlanned}
                                onChange={(_, checked) => update({ hidePlanned: checked })}
                            />
                        }
                        label={t`Also hide Planned`}
                    />
                    <FormControlLabel
                        control={
                            <Switch
                                checked={filters.hideNovelOneShot}
                                onChange={(_, checked) => update({ hideNovelOneShot: checked })}
                            />
                        }
                        label={t`Hide novels and one-shots`}
                    />
                    <FormLabel>{t`Type`}</FormLabel>
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                        {COMIC_TYPES.map((type) => (
                            <Chip
                                key={type}
                                size="small"
                                label={t(COMIC_TYPE_LABELS[type])}
                                color={filters.types.includes(type) ? 'primary' : 'default'}
                                variant={filters.types.includes(type) ? 'filled' : 'outlined'}
                                onClick={() => update({ types: toggleInList(filters.types, type) })}
                            />
                        ))}
                    </Stack>
                    <FormLabel>{t`Status`}</FormLabel>
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                        {REC_STATUSES.map((status) => (
                            <Chip
                                key={status}
                                size="small"
                                label={t(STATUS_BADGES[status].label)}
                                color={filters.statuses.includes(status) ? 'primary' : 'default'}
                                variant={filters.statuses.includes(status) ? 'filled' : 'outlined'}
                                onClick={() => update({ statuses: toggleInList(filters.statuses, status) })}
                            />
                        ))}
                    </Stack>
                    <FormLabel>{t`Minimum chapters`}</FormLabel>
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={filters.minChapters}
                        onChange={(_, value: number | null) => update({ minChapters: value ?? 0 })}
                    >
                        {MIN_CHAPTER_OPTIONS.map((value) => (
                            <ToggleButton key={value} value={value}>
                                {value === 0 ? t`Any` : value}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                    <FormLabel>{t`Minimum score`}</FormLabel>
                    <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={filters.minScore}
                        onChange={(_, value: number | null) => update({ minScore: value ?? 0 })}
                    >
                        {MIN_SCORE_OPTIONS.map((value) => (
                            <ToggleButton key={value} value={value}>
                                {value === 0 ? t`Any` : `${value}%`}
                            </ToggleButton>
                        ))}
                    </ToggleButtonGroup>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={filters.showAdult}
                                onChange={(_, checked) => update({ showAdult: checked })}
                            />
                        }
                        label={t`Show adult titles`}
                    />
                    {!!visibleTagOptions.length && (
                        <>
                            <FormLabel>{t`Tags`}</FormLabel>
                            <Stack
                                direction="row"
                                sx={{ gap: 0.5, flexWrap: 'wrap', maxHeight: 200, overflowY: 'auto' }}
                            >
                                {visibleTagOptions.map((name) => (
                                    <TriStateChip
                                        key={name}
                                        label={name}
                                        state={filters.tags[name]}
                                        onChange={(state) => update({ tags: setTriState(filters.tags, name, state) })}
                                    />
                                ))}
                            </Stack>
                        </>
                    )}
                    <Button
                        size="small"
                        sx={{ alignSelf: 'flex-end' }}
                        onClick={() => onFiltersChange({ ...DEFAULT_REC_FILTERS, sort: filters.sort })}
                    >
                        {t`Reset`}
                    </Button>
                </Stack>
            </Popover>
        </Stack>
    );
};
