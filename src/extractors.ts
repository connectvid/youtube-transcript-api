import { gotScraping } from 'got-scraping';
import { ProxyConfiguration } from 'crawlee';
import { CaptionTrack, TranscriptSegment } from './types.js';

type $ = any;

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const ANDROID_VERSION = '20.10.38';
const ANDROID_UA = `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 14)`;
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ProxyConfiguration gives us a fresh proxy URL per request (with rotation)
let _proxyConfig: ProxyConfiguration | undefined;
export function setProxyConfig(config: ProxyConfiguration | undefined): void { _proxyConfig = config; }

async function getProxyUrl(sessionId?: string): Promise<string | undefined> {
    if (!_proxyConfig) return undefined;
    return await _proxyConfig.newUrl(sessionId ?? `s_${Date.now()}`) ?? undefined;
}

/**
 * Fetch player response AND transcript in one call, using the SAME proxy session.
 * This ensures the timedtext URL's IP-locked signature matches the fetching IP.
 */
export async function fetchTranscriptData(videoId: string, preferredLang: string, includeAuto: boolean): Promise<{
    playerResponse: Record<string, any> | null;
    transcriptXml: string | null;
}> {
    for (let attempt = 0; attempt < 3; attempt++) {
        // Same session ID for both calls = same proxy IP
        const sessionId = `yt-${videoId}-${attempt}`;

        try {
            const proxyUrl = await getProxyUrl(sessionId);

            // Step 1: Get player response (caption tracks + metadata)
            const playerResp = await gotScraping({
                url: PLAYER_URL,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
                body: JSON.stringify({
                    context: { client: { clientName: 'ANDROID', clientVersion: ANDROID_VERSION } },
                    videoId,
                }),
                proxyUrl,
                responseType: 'json',
                retry: { limit: 0 },
                timeout: { request: 20000 },
            });

            const playerData = playerResp.body as Record<string, any>;
            const status = playerData?.playabilityStatus?.status;
            if (!status || status === 'ERROR') continue; // retry

            // Step 2: Find the best caption track
            const tracks = extractCaptionTracks(playerData);
            if (tracks.length === 0) return { playerResponse: playerData, transcriptXml: null };

            const track = selectCaptionTrack(tracks, preferredLang, includeAuto);
            if (!track) return { playerResponse: playerData, transcriptXml: null };

            // Step 3: Fetch transcript XML using SAME proxy session
            const xmlResp = await gotScraping({
                url: track.baseUrl,
                headers: { 'User-Agent': ANDROID_UA },
                proxyUrl, // Same proxy IP as the player request
                retry: { limit: 0 },
                timeout: { request: 20000 },
            });

            const xml = xmlResp.body;
            if (xml.length > 0) {
                return { playerResponse: playerData, transcriptXml: xml };
            }

            // XML empty — try again with different proxy
            return { playerResponse: playerData, transcriptXml: null };
        } catch { /* retry with new proxy */ }
    }

    return { playerResponse: null, transcriptXml: null };
}

/**
 * Extract ytInitialPlayerResponse from YouTube video page (fallback).
 */
export function extractPlayerResponseFromHtml($: $): Record<string, any> | null {
    const html = $.html();
    const match = html.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s)
        ?? html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;/s);
    if (match) {
        try { return JSON.parse(match[1]); } catch { return null; }
    }
    return null;
}

/**
 * Extract ytInitialData from YouTube page.
 */
export function extractInitialData($: $): Record<string, any> | null {
    const html = $.html();
    const match = html.match(/var\s+ytInitialData\s*=\s*({.+?})\s*;/s)
        ?? html.match(/ytInitialData\s*=\s*({.+?})\s*;/s);
    if (match) {
        try { return JSON.parse(match[1]); } catch { return null; }
    }
    return null;
}

/**
 * Extract caption tracks from player response.
 */
export function extractCaptionTracks(playerResponse: Record<string, any>): CaptionTrack[] {
    const captions = playerResponse?.captions?.playerCaptionsTracklistRenderer;
    if (!captions?.captionTracks) return [];
    return captions.captionTracks.map((track: any) => ({
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        name: track.name?.simpleText ?? track.name?.runs?.[0]?.text ?? track.languageCode,
        kind: track.kind,
        isTranslatable: track.isTranslatable ?? false,
    }));
}

/**
 * Extract video metadata from player response.
 */
export function extractVideoMetadata(playerResponse: Record<string, any>) {
    const vd = playerResponse?.videoDetails;
    const mf = playerResponse?.microformat?.playerMicroformatRenderer;
    if (!vd) return { title: null, channelName: null, channelUrl: null, description: null, viewCount: null, likeCount: null, publishDate: null, duration: null, thumbnailUrl: null };

    const secs = parseInt(vd.lengthSeconds || '0');
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    const dur = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
    const thumbs = vd.thumbnail?.thumbnails ?? [];

    return {
        title: vd.title ?? null,
        channelName: vd.author ?? null,
        channelUrl: vd.channelId ? `https://www.youtube.com/channel/${vd.channelId}` : null,
        description: vd.shortDescription ?? null,
        viewCount: vd.viewCount ? parseInt(vd.viewCount) : null,
        likeCount: null,
        publishDate: mf?.publishDate ?? mf?.uploadDate ?? null,
        duration: dur,
        thumbnailUrl: thumbs[thumbs.length - 1]?.url ?? null,
    };
}

/**
 * Select the best caption track.
 */
export function selectCaptionTrack(tracks: CaptionTrack[], lang: string, includeAuto: boolean): CaptionTrack | null {
    if (!tracks.length) return null;
    const manual = tracks.find(t => t.languageCode === lang && t.kind !== 'asr');
    if (manual) return manual;
    if (includeAuto) { const auto = tracks.find(t => t.languageCode === lang && t.kind === 'asr'); if (auto) return auto; }
    const prefix = tracks.find(t => t.languageCode.startsWith(lang) && (includeAuto || t.kind !== 'asr'));
    if (prefix) return prefix;
    const anyManual = tracks.find(t => t.kind !== 'asr');
    if (anyManual) return anyManual;
    return includeAuto ? tracks[0] : null;
}

/**
 * Parse transcript XML into segments.
 */
export function parseTranscriptXml(xml: string): TranscriptSegment[] {
    const segments: TranscriptSegment[] = [];

    const newFormat = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
    let match;
    while ((match = newFormat.exec(xml)) !== null) {
        const startMs = parseInt(match[1]);
        const durMs = parseInt(match[2]);
        let text = match[3].replace(/<s[^>]*>([^<]*)<\/s>/g, '$1').replace(/<[^>]+>/g, '');
        text = decodeEntities(text).trim();
        if (text) segments.push({ text, start: startMs / 1000, duration: durMs / 1000 });
    }

    if (segments.length > 0) return segments;

    const oldFormat = /<text\s+start="([^"]*)"\s+dur="([^"]*)"[^>]*>([^<]*)<\/text>/g;
    while ((match = oldFormat.exec(xml)) !== null) {
        const text = decodeEntities(match[3]).trim();
        if (text) segments.push({ text, start: parseFloat(match[1]), duration: parseFloat(match[2]) });
    }

    return segments;
}

function decodeEntities(s: string): string {
    return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/\n/g, ' ');
}

export function buildTranslationUrl(track: CaptionTrack, targetLang: string): string {
    const url = new URL(track.baseUrl);
    url.searchParams.set('tlang', targetLang);
    return url.toString();
}

export function segmentsToPlainText(segments: TranscriptSegment[]): string {
    return segments.map(s => s.text).join(' ');
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
    return segments.map((s, i) => `${i + 1}\n${fmtSrt(s.start)} --> ${fmtSrt(s.start + s.duration)}\n${s.text}\n`).join('\n');
}

export function segmentsToVtt(segments: TranscriptSegment[]): string {
    return 'WEBVTT\n\n' + segments.map(s => `${fmtVtt(s.start)} --> ${fmtVtt(s.start + s.duration)}\n${s.text}\n`).join('\n');
}

function fmtSrt(t: number): string {
    const h = Math.floor(t/3600), m = Math.floor((t%3600)/60), s = Math.floor(t%60), ms = Math.round((t%1)*1000);
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}
function fmtVtt(t: number): string { return fmtSrt(t).replace(',', '.'); }

export function extractPlaylistVideoIds(d: Record<string, any>): string[] {
    try {
        return (d?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
            ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]
            ?.playlistVideoListRenderer?.contents ?? [])
            .map((i: any) => i?.playlistVideoRenderer?.videoId).filter(Boolean);
    } catch { return []; }
}

export function extractSearchVideoIds(d: Record<string, any>): string[] {
    try {
        return (d?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? [])
            .flatMap((s: any) => (s?.itemSectionRenderer?.contents ?? []).map((i: any) => i?.videoRenderer?.videoId))
            .filter(Boolean);
    } catch { return []; }
}

export function extractChannelVideoIds(d: Record<string, any>): string[] {
    try {
        return (d?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [])
            .flatMap((tab: any) => {
                const c = tab?.tabRenderer?.content ?? tab?.expandableTabRenderer?.content;
                return (c?.richGridRenderer?.contents ?? c?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents ?? [])
                    .map((i: any) => i?.richItemRenderer?.content?.videoRenderer?.videoId ?? i?.gridVideoRenderer?.videoId);
            }).filter(Boolean);
    } catch { return []; }
}
