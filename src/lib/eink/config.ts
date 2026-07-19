/** Florianópolis — default aligned with site content. */
const DEFAULT_LAT = -27.5954;
const DEFAULT_LON = -48.548;
const DEFAULT_CITY = "Florianópolis";
const DEFAULT_RSS = [
  "https://hnrss.org/frontpage",
  "https://www.tabnews.com.br/recentes/rss",
].join(",");
const DEFAULT_REFRESH = 60;
const DEFAULT_TZ = "America/Sao_Paulo";

export const EINK_TIMEZONE = DEFAULT_TZ;

export type EinkQueryParams = {
  lat?: string | string[];
  lon?: string | string[];
  city?: string | string[];
  ical?: string | string[];
  rss?: string | string[];
  refresh?: string | string[];
  tz?: string | string[];
};

export type EinkConfig = {
  lat: number;
  lon: number;
  cityLabel: string;
  icalUrl: string;
  rssUrls: string[];
  refreshSeconds: number;
  timeZone: string;
};

function first(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed || undefined;
}

function parseRssList(raw: string): string[] {
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Env defaults, overridden by query params when present.
 * Supported params: lat, lon, city, ical, rss, refresh, tz
 */
export function getEinkConfig(query: EinkQueryParams = {}): EinkConfig {
  const qLat = first(query.lat);
  const qLon = first(query.lon);
  const qCity = first(query.city);
  const qIcal = first(query.ical);
  const qRss = first(query.rss);
  const qRefresh = first(query.refresh);
  const qTz = first(query.tz);

  const envLat = Number.parseFloat(process.env.EINK_LAT ?? "");
  const envLon = Number.parseFloat(process.env.EINK_LON ?? "");
  const latFromQuery = qLat !== undefined ? Number.parseFloat(qLat) : NaN;
  const lonFromQuery = qLon !== undefined ? Number.parseFloat(qLon) : NaN;

  const refreshRaw =
    qRefresh ?? process.env.EINK_REFRESH_SECONDS ?? String(DEFAULT_REFRESH);
  const refreshParsed = Number.parseInt(refreshRaw, 10);
  const refreshSeconds =
    Number.isFinite(refreshParsed) && refreshParsed >= 15
      ? refreshParsed
      : DEFAULT_REFRESH;

  return {
    lat: Number.isFinite(latFromQuery)
      ? latFromQuery
      : Number.isFinite(envLat)
        ? envLat
        : DEFAULT_LAT,
    lon: Number.isFinite(lonFromQuery)
      ? lonFromQuery
      : Number.isFinite(envLon)
        ? envLon
        : DEFAULT_LON,
    cityLabel:
      qCity || process.env.EINK_CITY_LABEL?.trim() || DEFAULT_CITY,
    icalUrl: qIcal || process.env.EINK_ICAL_URL?.trim() || "",
    rssUrls: parseRssList(
      qRss || process.env.EINK_RSS_URLS?.trim() || DEFAULT_RSS,
    ),
    refreshSeconds,
    timeZone: qTz || process.env.EINK_TIMEZONE?.trim() || DEFAULT_TZ,
  };
}
