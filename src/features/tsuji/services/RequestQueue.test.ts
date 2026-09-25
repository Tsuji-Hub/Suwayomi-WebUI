/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';

const recordStart = (starts: number[]) => () => {
    starts.push(Date.now());
    return Promise.resolve();
};

describe('SpacedQueue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('spaces tasks by the configured interval', async () => {
        const queue = new SpacedQueue(2100);
        const starts: number[] = [];

        const all = Promise.all([0, 1, 2].map(() => queue.run(recordStart(starts))));
        await vi.runAllTimersAsync();
        await all;

        expect(starts).toEqual([0, 2100, 4200]);
    });

    it('holds queued tasks while paused', async () => {
        const queue = new SpacedQueue(2100);
        const starts: number[] = [];

        queue.pauseUntil(10_000);
        const run = queue.run(recordStart(starts));
        await vi.runAllTimersAsync();
        await run;

        expect(starts).toEqual([10_000]);
    });

    it('re-waits when a pause is set while a task is already waiting', async () => {
        const queue = new SpacedQueue(2100);
        const starts: number[] = [];

        const first = queue.run(recordStart(starts));
        const second = queue.run(recordStart(starts));
        await vi.advanceTimersByTimeAsync(0);
        queue.pauseUntil(8000);
        await vi.runAllTimersAsync();
        await Promise.all([first, second]);

        expect(starts).toEqual([0, 8000]);
    });

    it('rejects an aborted task without running it', async () => {
        const queue = new SpacedQueue(2100);
        const task = vi.fn(() => Promise.resolve());
        const controller = new AbortController();

        const first = queue.run(() => Promise.resolve());
        const assertion = expect(queue.run(task, controller.signal)).rejects.toThrow('aborted');
        controller.abort(new Error('aborted'));
        await vi.runAllTimersAsync();

        await first;
        await assertion;
        expect(task).not.toHaveBeenCalled();
    });

    it('does not spend a slot on an aborted task', async () => {
        const queue = new SpacedQueue(2100);
        const starts: number[] = [];
        const controller = new AbortController();

        const first = queue.run(recordStart(starts));
        const aborted = queue.run(recordStart(starts), controller.signal).catch(() => 'aborted');
        const third = queue.run(recordStart(starts));
        controller.abort(new Error('aborted'));
        await vi.runAllTimersAsync();

        await Promise.all([first, aborted, third]);
        expect(starts).toEqual([0, 2100]);
    });
});
