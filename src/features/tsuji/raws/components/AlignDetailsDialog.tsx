/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';

/*
 * The art-matching report (`GET {api}/align?raw=`, brief #19), formatted: its plain values as a list (how many repeated
 * title or credit cards were skipped among them), each list of records (the candidates per raw chapter, with score and
 * overlap) as a table. The report's shape isn't fixed here: whatever it holds is shown.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isRecord = (value: Json): value is { [key: string]: Json } =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const formatValue = (value: Json): string => {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(3);
    }
    if (value === null || value === undefined) {
        return '';
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

const label = (key: string) => key.replaceAll('_', ' ');

const RecordsTable = ({ rows }: { rows: { [key: string]: Json }[] }) => {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    return (
        <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
            <TableHead>
                <TableRow>
                    {columns.map((column) => (
                        <TableCell key={column}>{label(column)}</TableCell>
                    ))}
                </TableRow>
            </TableHead>
            <TableBody>
                {rows.map((row, index) => (
                    // oxlint-disable-next-line react/no-array-index-key
                    <TableRow key={index}>
                        {columns.map((column) => (
                            <TableCell key={column}>{formatValue(row[column] ?? null)}</TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
};

const Report = ({ value, name }: { value: Json; name?: string }) => {
    if (Array.isArray(value)) {
        const records = value.filter(isRecord);
        return (
            <Stack sx={{ gap: 0.5, overflowX: 'auto' }}>
                {name && <Typography variant="subtitle2">{label(name)}</Typography>}
                {records.length === value.length && records.length ? (
                    <RecordsTable rows={records} />
                ) : (
                    <Typography variant="body2">{value.map(formatValue).join(', ')}</Typography>
                )}
            </Stack>
        );
    }
    if (isRecord(value)) {
        const entries = Object.entries(value);
        const plain = entries.filter(([, each]) => !each || typeof each !== 'object');
        const nested = entries.filter(([, each]) => !!each && typeof each === 'object');
        return (
            <Stack sx={{ gap: 1.5 }}>
                {name && <Typography variant="subtitle2">{label(name)}</Typography>}
                {!!plain.length && (
                    <Stack component="dl" sx={{ m: 0 }}>
                        {plain.map(([key, each]) => (
                            <Typography key={key} variant="body2">
                                <strong>{label(key)}:</strong> {formatValue(each)}
                            </Typography>
                        ))}
                    </Stack>
                )}
                {nested.map(([key, each]) => (
                    <Report key={key} name={key} value={each} />
                ))}
            </Stack>
        );
    }
    return <Typography variant="body2">{formatValue(value)}</Typography>;
};

export const AlignDetailsDialog = ({ url, onClose }: { url: string | null; onClose: () => void }) => {
    const { t } = useLingui();
    const [state, setState] = useState<{ url: string; report?: Json; failed?: boolean } | null>(null);

    useEffect(() => {
        if (!url) {
            return undefined;
        }
        const controller = new AbortController();
        setState({ url });
        fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
            .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
            .then((report: Json) => setState({ url, report }))
            .catch(() => !controller.signal.aborted && setState({ url, failed: true }));
        return () => controller.abort();
    }, [url]);

    const current = state?.url === url ? state : null;

    return (
        <Dialog open={!!url} onClose={onClose} maxWidth="md" fullWidth onClick={(event) => event.stopPropagation()}>
            <DialogTitle>{t`Raw vs English: art match`}</DialogTitle>
            <DialogContent>
                {current?.failed && <Typography color="error">{t`Couldn't load the report.`}</Typography>}
                {current && !current.failed && current.report === undefined && (
                    <Typography sx={{ color: 'text.secondary' }}>{t`Loading…`}</Typography>
                )}
                {current?.report !== undefined && <Report value={current.report} />}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t`Close`}</Button>
            </DialogActions>
        </Dialog>
    );
};
