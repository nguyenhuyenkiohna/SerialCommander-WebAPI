const PROJECT_KEYWORDS = [
  "serial",
  "uart",
  "usart",
  "arduino",
  "esp32",
  "esp8266",
  "stm32",
  "mqtt",
  "mosquitto",
  "web serial",
  "rs232",
  "usb",
  "embedded",
  "microcontroller",
  "pio",
  "platformio",
];

const DEFAULT_TOPICS =
  "arduino serial uart,esp32 uart,stm32 uart,web serial api,mqtt iot serial";

function parseProjectTopics() {
  const raw = process.env.YOUTUBE_PROJECT_TOPICS || DEFAULT_TOPICS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildSearchQuery(userQuery) {
  const q = String(userQuery || "").trim();
  if (!q) return parseProjectTopics()[0] || "arduino serial uart";
  const topics = parseProjectTopics();
  const ctx = topics[0] || "serial uart embedded";
  return `${q} ${ctx}`;
}

function haystackFromSnippet(snippet) {
  return `${snippet?.title || ""} ${snippet?.channelTitle || ""} ${snippet?.description || ""}`.toLowerCase();
}

function isRelevantToProject(snippet) {
  const hay = haystackFromSnippet(snippet);
  return PROJECT_KEYWORDS.some((kw) => hay.includes(kw));
}

function getApiKey() {
  return (process.env.YOUTUBE_API_KEY || "").trim();
}

/**
 * @param {string} userQuery
 * @param {number} [maxResults]
 */
async function searchYoutube(userQuery, maxResults = 12) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      apiEnabled: false,
      items: [],
      source: "curated",
      hint: "Chưa cấu hình YOUTUBE_API_KEY trên server — chỉ lọc danh sách gợi ý trên app.",
    };
  }

  const q = buildSearchQuery(userQuery);
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", String(Math.min(Math.max(maxResults * 2, 8), 25)));
  url.searchParams.set("q", q);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("safeSearch", "moderate");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("relevanceLanguage", "vi");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      `YouTube Data API lỗi HTTP ${res.status}`;
    const err = new Error(msg);
    err.statusCode = res.status === 403 ? 403 : 502;
    throw err;
  }

  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = [];
  for (const row of rawItems) {
    const id = row?.id?.videoId;
    const snippet = row?.snippet;
    if (!id || !snippet) continue;
    if (!isRelevantToProject(snippet)) continue;
    items.push({
      id,
      title: snippet.title || id,
      channelTitle: snippet.channelTitle || "",
    });
    if (items.length >= maxResults) break;
  }

  return {
    apiEnabled: true,
    source: "youtube",
    query: q,
    items,
    filteredOut: rawItems.length - items.length,
  };
}

module.exports = {
  searchYoutube,
  buildSearchQuery,
  isRelevantToProject,
  PROJECT_KEYWORDS,
};
