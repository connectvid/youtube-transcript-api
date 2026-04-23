import { Actor, log, LogLevel } from 'apify';
import { CheerioCrawler } from 'crawlee';
import { router } from './routes.js';
import { Input } from './types.js';
import { DEFAULTS, LABELS, YOUTUBE, PATTERNS } from './constants.js';
import { loadState, saveState, getState } from './state.js';

await Actor.init();

const input = await Actor.getInput<Input>() ?? {};

// --- Input validation ---
if (!input.startUrls?.length && !input.searchTerms?.length && !input.videoIds?.length) {
    await Actor.fail('Provide at least one Start URL, Search Term, or Video ID.');
    return;
}

const {
    startUrls = [],
    searchTerms = [],
    videoIds = [],
    maxItems = DEFAULTS.MAX_ITEMS,
    maxConcurrency = DEFAULTS.MAX_CONCURRENCY,
    debugMode = false,
    proxyConfig,
} = input;

if (debugMode) log.setLevel(LogLevel.DEBUG);

// --- State persistence ---
await loadState();
Actor.on('persistState', saveState);
Actor.on('migrating', saveState);

// --- Proxy setup ---
const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);

// --- Build request list ---
const requests: { url: string; label: string; userData: Record<string, unknown>; uniqueKey?: string }[] = [];

// Process start URLs — auto-detect type
for (const req of startUrls) {
    const url = req.url.trim();

    if (PATTERNS.PLAYLIST_ID.test(url)) {
        requests.push({
            url,
            label: LABELS.PLAYLIST,
            userData: { input },
            uniqueKey: `playlist-${url.match(PATTERNS.PLAYLIST_ID)?.[1]}`,
        });
    } else if (PATTERNS.CHANNEL_HANDLE.test(url) || PATTERNS.CHANNEL_ID.test(url)) {
        // Ensure we hit the videos tab
        const channelUrl = url.includes('/videos') ? url : `${url.replace(/\/$/, '')}/videos`;
        requests.push({
            url: channelUrl,
            label: LABELS.CHANNEL,
            userData: { input },
        });
    } else if (PATTERNS.VIDEO_ID.test(url)) {
        const videoId = url.match(PATTERNS.VIDEO_ID)?.[1];
        requests.push({
            url: `${YOUTUBE.VIDEO_URL}${videoId}`,
            label: LABELS.VIDEO,
            userData: { input },
            uniqueKey: `video-${videoId}`,
        });
    } else {
        // Unknown URL type — try as video page
        requests.push({
            url,
            label: LABELS.VIDEO,
            userData: { input },
        });
    }
}

// Process direct video IDs
for (const id of videoIds) {
    const cleanId = id.trim();
    if (cleanId.length === 11) {
        requests.push({
            url: `${YOUTUBE.VIDEO_URL}${cleanId}`,
            label: LABELS.VIDEO,
            userData: { input },
            uniqueKey: `video-${cleanId}`,
        });
    }
}

// Process search terms
for (const term of searchTerms) {
    requests.push({
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`,
        label: LABELS.SEARCH,
        userData: { input, searchTerm: term },
        uniqueKey: `search-${term}`,
    });
}

log.info(`Starting with ${requests.length} initial requests (${videoIds.length} video IDs, ${startUrls.length} URLs, ${searchTerms.length} search terms)`);

// --- Crawler ---
const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency,
    maxRequestRetries: DEFAULTS.MAX_REQUEST_RETRIES,
    requestHandlerTimeoutSecs: DEFAULTS.REQUEST_TIMEOUT_SECS,
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 30,
        sessionOptions: {
            maxUsageCount: 30,
            maxAgeSecs: 1800,
        },
    },
    persistCookiesPerSession: true,
    preNavigationHooks: [
        async ({ request }) => {
            // Set consent cookie to bypass YouTube's consent screen
            request.headers = {
                ...request.headers,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': `SOCS=${YOUTUBE.CONSENT_COOKIE}`,
            };
        },
    ],
    requestHandler: router,
    failedRequestHandler: async ({ request, error }) => {
        log.error(`Failed: ${request.url}`, { error: error?.message ?? 'Unknown error' });
        const videoId = request.url.match(PATTERNS.VIDEO_ID)?.[1];
        if (request.label === LABELS.VIDEO && videoId) {
            await Actor.pushData({
                url: request.url,
                videoId,
                title: null,
                transcript: null,
                fullText: null,
                '#isFailed': true,
                '#errorMessage': error?.message ?? 'Unknown error',
                scrapedAt: new Date().toISOString(),
            });
        }
    },
});

await crawler.run(requests);

await saveState();
const finalState = getState();
log.info(`Complete. Scraped ${finalState.itemsScraped} transcripts.`);
await Actor.setStatusMessage(`Done. ${finalState.itemsScraped} transcripts extracted.`);
await Actor.exit();
