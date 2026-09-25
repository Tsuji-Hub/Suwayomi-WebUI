/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

type Waiter = { start: () => void };

/**
 * Starts tasks in call order, no closer together than `spacingMs`, and holds every queued task while paused
 * (e.g. after a 429). A slot is only handed out when a task reaches the front, so aborted tasks never use one.
 */
export class SpacedQueue {
    private readonly waiters: Waiter[] = [];

    private lastStart = -Infinity;

    private pausedUntil = 0;

    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly spacingMs: number,
        private readonly now: () => number = Date.now,
    ) {}

    pauseUntil(epochMs: number): void {
        this.pausedUntil = Math.max(this.pausedUntil, epochMs);
    }

    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted();

        await new Promise<void>((resolve, reject) => {
            const waiter: Waiter = { start: resolve };

            signal?.addEventListener(
                'abort',
                () => {
                    const index = this.waiters.indexOf(waiter);
                    if (index !== -1) {
                        this.waiters.splice(index, 1);
                        reject(signal.reason);
                    }
                },
                { once: true },
            );

            this.waiters.push(waiter);
            this.pump();
        });

        return task();
    }

    private pump(): void {
        if (this.timer !== null || !this.waiters.length) {
            return;
        }

        const waitMs = Math.max(this.lastStart + this.spacingMs, this.pausedUntil) - this.now();
        if (waitMs > 0) {
            // Re-evaluated on wake-up: the pause may have been extended or the head waiter aborted.
            this.timer = setTimeout(() => {
                this.timer = null;
                this.pump();
            }, waitMs);
            return;
        }

        const waiter = this.waiters.shift()!;
        this.lastStart = this.now();
        waiter.start();
        this.pump();
    }
}
