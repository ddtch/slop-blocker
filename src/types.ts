// Shared domain types. Kept dependency-free so both the service worker and
// content scripts (and unit tests, which have no `chrome` global) can import it.

/** Where a detection signal came from. See SPEC.md §2. */
export type SignalSource =
  | 'platform-label'
  | 'c2pa'
  | 'iptc-metadata'
  | 'creator-list'
  | 'keyword'
  | 'user-marked';

export type Confidence = 'confirmed' | 'likely' | 'suspected';

export type MediaType = 'video' | 'image' | 'post' | 'audio' | 'embed' | 'page';

/** Identifies an account across platforms. `handle` is what we show; `id` is stable. */
export interface CreatorRef {
  platform: string;
  /** Platform-stable identifier when available (e.g. a YouTube channel id). */
  id?: string;
  /** Human-facing handle, normalised to lower case without a leading "@". */
  handle?: string;
  /** Display name, for UI only — never used for matching. */
  name?: string;
}

export interface Detection {
  /** Stable across re-renders of the same media on the same page. */
  id: string;
  tabId: number;
  /** Page URL without the hash. */
  url: string;
  mediaUrl?: string;
  mediaType: MediaType;
  /** Every signal that fired, de-duplicated. */
  source: SignalSource[];
  confidence: Confidence;
  /** Localised, human-readable explanation shown in the shroud and the popup. */
  reason: string;
  detectedAt: number;
  revealed: boolean;
  /** True when the detection was blocked (vs. only badged as suspected). */
  blocked: boolean;
  creator?: CreatorRef;
  /** Set when we paused a video because of this detection. */
  pausedVideo?: boolean;
}

/** What a signal provider returns before confidences are merged. */
export interface PartialDetection {
  source: SignalSource;
  /** Confidence this single signal justifies on its own. */
  confidence: Confidence;
  reason: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  creator?: CreatorRef;
}

export type Threshold = Confidence;

export type TrackerMode = 'off' | 'count' | 'block';

export interface Settings {
  enabled: boolean;
  /** Hostnames where the extension does nothing. */
  disabledSites: string[];
  /** Lowest confidence that still gets blocked. */
  threshold: Threshold;
  autoPauseVideos: boolean;
  wholePageMode: boolean;
  wholePageThreshold: number;
  trackerMode: TrackerMode;
  /** Reserved for M2 remote list updates; must stay false in v1. */
  listUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  disabledSites: [],
  threshold: 'likely',
  autoPauseVideos: true,
  wholePageMode: false,
  wholePageThreshold: 5,
  trackerMode: 'count',
  listUpdates: false,
};

export interface PersonalLists {
  blockCreators: CreatorRef[];
  trustCreators: CreatorRef[];
  blockDomains: string[];
}

export const EMPTY_PERSONAL_LISTS: PersonalLists = {
  blockCreators: [],
  trustCreators: [],
  blockDomains: [],
};

export interface Counters {
  lifetimeBlocked: number;
  lifetimeByType: Record<MediaType, number>;
  lifetimeTrackers: number;
  sessionBlocked: number;
}

export const EMPTY_COUNTERS: Counters = {
  lifetimeBlocked: 0,
  lifetimeByType: { video: 0, image: 0, post: 0, audio: 0, embed: 0, page: 0 },
  lifetimeTrackers: 0,
  sessionBlocked: 0,
};

export interface TrackerStat {
  domain: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Bundled lists (lists/*.json)
// ---------------------------------------------------------------------------

/**
 * Text markers, split by how much one hit is worth. The tiers exist because
 * "generated with AI" can only be a disclosure, while "AI-generated" is just as
 * likely to be the topic of a video complaining about AI content.
 */
export interface KeywordLists {
  /** Disclosure-shaped phrases and self-tagging hashtags: one hit is enough. */
  disclosure: string[];
  /** Reads as either a disclosure or a topic: two hits needed to block. */
  ambiguous: string[];
  /** Suggestive only; never enough to block. */
  weak: string[];
}

export interface CreatorLists {
  youtubeChannels: string[];
  tiktokUsers: string[];
  instagramUsers: string[];
  xUsers: string[];
  domains: string[];
}

/** Platform -> locale -> disclosure strings, as rendered by the platform. */
export type DisclosureStrings = Record<string, Record<string, string[]>>;

export interface BundledLists {
  keywords: KeywordLists;
  creators: CreatorLists;
  disclosure: DisclosureStrings;
}

/** Everything a content script needs to run, delivered once at startup. */
export interface PageContext {
  href: string;
  hostname: string;
  /** BCP-47-ish language tag of the page, lower-cased. */
  locale: string;
  settings: Settings;
  personalLists: PersonalLists;
  lists: BundledLists;
}
