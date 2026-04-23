export const LABELS = {
    VIDEO: 'VIDEO',
    PLAYLIST: 'PLAYLIST',
    CHANNEL: 'CHANNEL',
    SEARCH: 'SEARCH',
} as const;

export const DEFAULTS = {
    MAX_ITEMS: 50,
    MAX_CONCURRENCY: 10,
    MAX_REQUEST_RETRIES: 3,
    REQUEST_TIMEOUT_SECS: 60,
    LANGUAGE: 'en',
    OUTPUT_FORMAT: 'json' as const,
} as const;

export const YOUTUBE = {
    VIDEO_URL: 'https://www.youtube.com/watch?v=',
    INNERTUBE_API: 'https://www.youtube.com/youtubei/v1',
    INNERTUBE_KEY: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
    INNERTUBE_CLIENT: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00',
        hl: 'en',
        gl: 'US',
    },
    CONSENT_COOKIE: 'SOCS=CAESEwgDEgk2NDcwMTcxMjQaAmVuIAEaBgiA_LyaBg',
} as const;

export const BLOCK_KEYWORDS = {
    TITLE: ['Access Denied', 'Robot Check', 'Before you continue'],
    BODY: ['unusual traffic', 'verify you are a human'],
} as const;

// Regex patterns for YouTube URL parsing
export const PATTERNS = {
    VIDEO_ID: /(?:v=|\/v\/|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/,
    PLAYLIST_ID: /[?&]list=([a-zA-Z0-9_-]+)/,
    CHANNEL_HANDLE: /\/@([a-zA-Z0-9_-]+)/,
    CHANNEL_ID: /\/channel\/([a-zA-Z0-9_-]+)/,
} as const;
