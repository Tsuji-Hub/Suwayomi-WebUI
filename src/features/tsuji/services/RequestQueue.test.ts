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

    it('lets a burst start together, then refills one per interval', async () => {
        const queue = new SpacedQueue(2100, { burst: 3 });
        const starts: number[] = [];

        const all = Promise.all([0, 1, 2, 3, 4].map(() => queue.run(recordStart(starts))));
        await vi.runAllTimersAsync();
        await all;

        expect(starts).toEqual([0, 0, 0, 2100, 4200]);
    });

    it('refills the burst while idle, capped at the burst size', async () => {
        const queue = new SpacedQueue(2100, { burst: 2 });
        const starts: number[] = [];

        await Promise.all([queue.run(recordStart(starts)), queue.run(recordStart(starts))]);
        vi.setSystemTime(60_000);
        const all = Promise.all([0, 1, 2].map(() => queue.run(recordStart(starts))));
        await vi.runAllTimersAsync();
        await all;

        expect(starts).toEqual([0, 0, 60_000, 60_000, 62_100]);
    });

    it('refunds the token when aborted after leaving the queue but before starting', async () => {
        const queue = new SpacedQueue(2100, { burst: 1 });
        const starts: number[] = [];
        const task = vi.fn(() => Promise.resolve());
        const controller = new AbortController();

        const aborted = queue.run(task, controller.signal).catch(() => 'aborted');
        controller.abort(new Error('aborted'));
        const next = queue.run(recordStart(starts));
        await vi.runAllTimersAsync();

        expect(await aborted).toBe('aborted');
        await next;
        expect(task).not.toHaveBeenCalled();
        expect(starts).toEqual([0]);
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
