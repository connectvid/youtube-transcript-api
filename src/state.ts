import { Actor } from 'apify';
import { CrawlState } from './types.js';

const STATE_KEY = 'CRAWL_STATE';

let state: CrawlState = {
    itemsScraped: 0,
};

const seenIds = new Set<string>();

export async function loadState(): Promise<void> {
    const saved = await Actor.getValue<CrawlState>(STATE_KEY);
    if (saved) state = saved;
}

export async function saveState(): Promise<void> {
    await Actor.setValue(STATE_KEY, state);
}

export function getState(): CrawlState {
    return state;
}

export function incrementItems(count = 1): void {
    state.itemsScraped += count;
}

export function hasReachedLimit(maxItems: number): boolean {
    if (maxItems <= 0) return false;
    return state.itemsScraped >= maxItems;
}

export function isDuplicate(id: string): boolean {
    if (seenIds.has(id)) return true;
    seenIds.add(id);
    return false;
}
