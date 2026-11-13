const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const cache = new Map();

const TMDB_IMAGE = "https://image.tmdb.org/t/p/original";
const FALLBACK = "لا يتوفر وصف عربي لهذا العمل حاليًا.";

function json(data) {
  return new Response(JSON.stringify(data), { headers: CORS });
}

function encodeId(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeId(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, c => c.charCodeAt(0))
  );
}

function decodeItemId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getFilename(videoUrl) {
  try {
    return decodeURIComponent(new URL(videoUrl).pathname.split("/").pop() || "");
  } catch {
    return "Direct Video";
  }
}

function normalize(value) {
  return (value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function exactMatch(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  return !!x && x === y;
}

function titleScore(a, b) {
  const x = normalize(a);
  const y = normalize(b);

  if (!x || !y) return 0;
  if (x === y) return 100;
  if (x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x))) return 88;

  const wa = (a || "").toLowerCase().split(/[\s._-]+/).filter(Boolean);
  const wb = (b || "").toLowerCase().split(/[\s._-]+/).filter(Boolean);

  const matched = wa.filter(w =>
    wb.some(v => normalize(w) === normalize(v))
  ).length;

  return Math.round(matched / Math.max(wa.length, wb.length) * 75);
}

function cleanFilenameTitle(value) {
  return (value || "")
    .replace(/^\[[^\]]+\]\s*/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(?:1080p|720p|2160p|480p|4k|8k|web|bluray|hevc|x265|x264)[^)]*\)/gi, " ")
    .replace(/\b(2160p|1080p|720p|480p|4k|8k|WEB-DL|WEBRip|WEB|BluRay|BDRip|BRRip|HEVC|H265|H264|x265|x264|AAC|DTS|10bit|HDR|NF|AMZN|DSNP|CR|ATVP)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFilename(filename) {
  let name = cleanFilenameTitle(filename.replace(/\.[^.]+$/, ""));
  let title = name;
  let season = null;
  let episode = null;
  let absoluteEpisode = null;

  let match;

  // S04 - 02 or S04E02
  match = name.match(/\bS(\d{1,2})\s*[-._ ]*\s*E?(\d{1,3})\b/i);

  if (match) {
    season = Number(match[1]);
    episode = Number(match[2]);
    title = name.slice(0, match.index).trim();
  }

  // Season 2 - 02
  if (!match) {
    match = name.match(/\bSeason\s*(\d{1,2})\s*[-._ ]*\s*(?:Episode\s*)?(\d{1,3})\b/i);

    if (match) {
      season = Number(match[1]);
      episode = Number(match[2]);
      title = name.slice(0, match.index).trim();
    }
  }

  // 2nd Season - 02
  if (!match) {
    match = name.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\s*[-._ ]*(?:Episode\s*)?(\d{1,3})\b/i);

    if (match) {
      season = Number(match[1]);
      episode = Number(match[2]);
      title = name.slice(0, match.index).trim();
    }
  }

  // 2x02
  if (!match) {
    match = name.match(/\b(\d{1,2})x(\d{1,3})\b/i);

    if (match) {
      season = Number(match[1]);
      episode = Number(match[2]);
      title = name.slice(0, match.index).trim();
    }
  }

  // Absolute episode number
  if (!match) {
    match = name.match(/(?:^|[\s._-])[-._ ]*(\d{1,4})(?:v\d+)?\s*$/i);

    if (match) {
      const number = Number(match[1]);
      const before = name.slice(0, match.index).trim();

      if (
        number >= 1 &&
        number <= 9999 &&
        before.length >= 2 &&
        !(number >= 1900 && number <= 2099 && match[1].length === 4)
      ) {
        absoluteEpisode = number;
        title = before;
      }
    }
  }

  // Remove season suffix if it remains in the title.
  title = title
    .replace(/\b\d{1,2}(?:st|nd|rd|th)\s+Season\b/gi, "")
    .replace(/\bSeason\s*\d{1,2}\b/gi, "")
    .replace(/\bS\d{1,2}\b/gi, "")
    .replace(/[-_. ]+$/, "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || name || "Direct Video",
    originalTitle: name,
    season,
    episode,
    absoluteEpisode
  };
}

function displayTitle(title, info) {
  if (info.season !== null && info.episode !== null) {
    return `${title} - S${String(info.season).padStart(2, "0")}E${String(info.episode).padStart(2, "0")}`;
  }

  if (info.absoluteEpisode !== null) {
    return `${title} - ${info.absoluteEpisode}`;
  }

  return title;
}

function tmdbImage(path) {
  return path ? `${TMDB_IMAGE}${path}` : undefined;
}

async function fetchJSON(url, options = {}, timeout = 10000) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeout)
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Translation fallback 1: Google.
async function translateGoogle(text) {
  const url =
    "https://translate.googleapis.com/translate_a/single" +
    "?client=gtx&sl=auto&tl=ar&dt=t&q=" +
    encodeURIComponent(text);

  const data = await fetchJSON(url, {}, 12000);

  if (!data?.[0]) return null;

  const result = data[0].map(x => x[0] || "").join("").trim();

  return /[\u0600-\u06FF]/.test(result) ? result : null;
}

// Translation fallback 2: MyMemory.
async function translateMemory(text) {
  const chunks = text.match(/[\s\S]{1,450}/g) || [];
  const output = [];

  for (const chunk of chunks) {
    const url =
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(chunk) +
      "&langpair=en|ar";

    const data = await fetchJSON(url, {}, 12000);
    const translated = data?.responseData?.translatedText;

    if (!translated || data?.responseStatus !== 200) return null;

    output.push(translated);
  }

  const result = output.join(" ").trim();
  return /[\u0600-\u06FF]/.test(result) ? result : null;
}

async function translateArabic(text) {
  if (!text || !text.trim()) return FALLBACK;

  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasEnglish = /[A-Za-z]/.test(text);

  if (hasArabic && !hasEnglish) return text;

  const google = await translateGoogle(text);
  if (google) return google;

  const memory = await translateMemory(text);
  if (memory) return memory;

  // Never expose an English-only description.
  return hasArabic ? text : FALLBACK;
}

async function tmdbFetch(endpoint, token) {
  if (!token) return null;

  return fetchJSON(
    `https://api.themoviedb.org/3${endpoint}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    },
    10000
  );
}

function bestTMDBMatch(title, results, type) {
  let best = null;
  let score = 0;

  for (const item of results || []) {
    const names = type === "movie"
      ? [item.title, item.original_title]
      : [item.name, item.original_name];

    for (const name of names.filter(Boolean)) {
      const current = titleScore(title, name);

      if (current > score) {
        score = current;
        best = item;
      }
    }
  }

  return score >= 65 ? best : null;
}

async function fetchTMDBSeries(title, info, token) {
  const key = `tmdb-series:${title}:${info.season}:${info.episode}`;

  if (cache.has(key)) return cache.get(key);

  const search = await tmdbFetch(
    `/search/tv?query=${encodeURIComponent(title)}&language=en-US&include_adult=false`,
    token
  );

  const match = bestTMDBMatch(title, search?.results, "tv");
  if (!match) return null;

  const [english, arabic] = await Promise.all([
    tmdbFetch(`/tv/${match.id}?language=en-US`, token),
    tmdbFetch(`/tv/${match.id}?language=ar-SA`, token)
  ]);

  if (!english) return null;

  let episodeEnglish = null;
  let episodeArabic = null;

  if (info.season !== null && info.episode !== null) {
    [episodeEnglish, episodeArabic] = await Promise.all([
      tmdbFetch(
        `/tv/${match.id}/season/${info.season}/episode/${info.episode}?language=en-US`,
        token
      ),
      tmdbFetch(
        `/tv/${match.id}/season/${info.season}/episode/${info.episode}?language=ar-SA`,
        token
      )
    ]);
  }

  const result = {
    name: english.name || match.name || title,
    poster: tmdbImage(english.poster_path || match.poster_path),
    background: tmdbImage(english.backdrop_path || match.backdrop_path),

    description:
      arabic?.overview ||
      english.overview ||
      match.overview ||
      "",

    episodeName:
      episodeEnglish?.name || null,

    episodeDescription:
      episodeArabic?.overview ||
      episodeEnglish?.overview ||
      null,

    episodeReleased:
      episodeEnglish?.air_date || null,

    releaseInfo:
      english.first_air_date?.slice(0, 4),

    genres:
      (english.genres || []).map(g => g.name)
  };

  cache.set(key, result);
  return result;
}

async function fetchTMDBMovie(title, token) {
  const key = `tmdb-movie:${title}`;

  if (cache.has(key)) return cache.get(key);

  const search = await tmdbFetch(
    `/search/movie?query=${encodeURIComponent(title)}&language=en-US&include_adult=false`,
    token
  );

  const match = bestTMDBMatch(title, search?.results, "movie");
  if (!match) return null;

  const [english, arabic] = await Promise.all([
    tmdbFetch(`/movie/${match.id}?language=en-US`, token),
    tmdbFetch(`/movie/${match.id}?language=ar-SA`, token)
  ]);

  if (!english) return null;

  const result = {
    name: english.title || match.title || title,
    poster: tmdbImage(english.poster_path || match.poster_path),
    background: tmdbImage(english.backdrop_path || match.backdrop_path),
    description: arabic?.overview || english.overview || match.overview || "",
    releaseInfo: english.release_date?.slice(0, 4),
    genres: (english.genres || []).map(g => g.name)
  };

  cache.set(key, result);
  return result;
}

// AniList search with multiple title variants.
async function fetchAniList(title) {
  const key = `anilist:${title}`;
  if (cache.has(key)) return cache.get(key);

  const query = `
    query ($search: String) {
      Page(perPage: 30) {
        media(search: $search, type: ANIME) {
          title {
            romaji
            english
            native
          }
          synonyms
          description(asHtml: false)
          coverImage {
            extraLarge
            large
          }
          bannerImage
          seasonYear
          genres
        }
      }
    }
  `;

  const data = await fetchJSON(
    "https://graphql.anilist.co",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { search: title }
      })
    },
    12000
  );

  const results = data?.data?.Page?.media || [];

  let best = null;
  let bestScore = 0;

  for (const item of results) {
    const names = [
      item.title?.english,
      item.title?.romaji,
      item.title?.native,
      ...(item.synonyms || [])
    ].filter(Boolean);

    for (const name of names) {
      const score = titleScore(title, name);

      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }

  if (!best || bestScore < 65) return null;

  const result = {
    name: best.title?.english || best.title?.romaji || title,
    poster: best.coverImage?.extraLarge || best.coverImage?.large,
    background: best.bannerImage || undefined,
    description: best.description || "",
    releaseInfo: best.seasonYear ? String(best.seasonYear) : undefined,
    genres: best.genres || []
  };

  cache.set(key, result);
  return result;
}

// MyAnimeList fallback through Jikan API.
async function fetchMAL(title) {
  const key = `mal:${title}`;
  if (cache.has(key)) return cache.get(key);

  const data = await fetchJSON(
    `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(title)}&limit=10`,
    {},
    15000
  );

  const results = data?.data || [];

  let best = null;
  let bestScore = 0;

  for (const item of results) {
    const names = [
      item.title,
      item.title_english,
      item.title_japanese,
      ...(item.titles || []).map(x => x.title)
    ].filter(Boolean);

    for (const name of names) {
      const score = titleScore(title, name);

      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }

  if (!best || bestScore < 65) return null;

  const result = {
    name: best.title_english || best.title || title,
    poster:
      best.images?.jpg?.large_image_url ||
      best.images?.jpg?.image_url ||
      best.images?.webp?.large_image_url,
    background: undefined,
    description: best.synopsis || "",
    releaseInfo: best.year ? String(best.year) : undefined,
    genres: (best.genres || []).map(x => x.name)
  };

  cache.set(key, result);
  return result;
}

async function fetchAnime(title, originalTitle) {
  const candidates = [...new Set([title, originalTitle].filter(Boolean))];

  for (const candidate of candidates) {
    const anime = await fetchAniList(candidate);
    if (anime?.poster) return anime;
  }

  for (const candidate of candidates) {
    const mal = await fetchMAL(candidate);
    if (mal?.poster) return mal;
  }

  return null;
}

async function fetchSeries(title, info) {
  const key = `series:${title}:${info.season}:${info.episode}:${info.absoluteEpisode}`;
  if (cache.has(key)) return cache.get(key);

  const searchUrl =
    `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(title)}.json`;

  const searchData = await fetchJSON(searchUrl, {}, 8000);
  const metas = searchData?.metas || [];

  let match = null;
  let score = 0;

  for (const item of metas) {
    const current = titleScore(title, item.name);
    if (current > score) {
      score = current;
      match = item;
    }
  }

  if (!match || score < 65) return null;

  const metaData = await fetchJSON(
    `https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(match.id)}.json`,
    {},
    8000
  );

  const series = metaData?.meta;
  if (!series) return null;

  let episode = null;

  if (info.season !== null && info.episode !== null) {
    episode = (series.videos || []).find(v =>
      Number(v.season) === info.season &&
      Number(v.episode) === info.episode
    );
  }

  if (!episode && info.absoluteEpisode !== null) {
    episode = (series.videos || []).find(v =>
      Number(v.episode) === info.absoluteEpisode ||
      Number(v.number) === info.absoluteEpisode
    );
  }

  const result = {
    name: series.name || title,
    poster: series.poster,
    background: series.background,
    description: series.description || "",
    releaseInfo: series.releaseInfo,
    genres: series.genres || [],
    episodeName: episode?.title || null,
    episodeDescription: episode?.overview || null,
    episodeReleased: episode?.released || null,
    mappedSeason: episode?.season != null ? Number(episode.season) : null,
    mappedEpisode: episode?.episode != null ? Number(episode.episode) : null
  };

  cache.set(key, result);
  return result;
}

async function fetchMovie(title) {
  const key = `movie:${title}`;
  if (cache.has(key)) return cache.get(key);

  const data = await fetchJSON(
    `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(title)}.json`,
    {},
    8000
  );

  const metas = data?.metas || [];

  let match = null;
  let score = 0;

  for (const item of metas) {
    const current = titleScore(title, item.name);
    if (current > score) {
      score = current;
      match = item;
    }
  }

  if (!match || score < 65) return null;

  const result = {
    name: match.name,
    poster: match.poster,
    background: match.background,
    description: match.description || "",
    releaseInfo: match.releaseInfo,
    genres: match.genres || []
  };

  cache.set(key, result);
  return result;
}

async function getMetadataRaw(videoUrl, token) {
  const info = parseFilename(getFilename(videoUrl));

  const fallback = {
    name: displayTitle(info.title, info),
    description: ""
  };

  // 1. Anime: AniList first, MAL second.
  const anime = await fetchAnime(info.title, info.originalTitle);

  if (anime) {
    let mappedInfo = info;

    if (info.absoluteEpisode !== null) {
      const mapping = await fetchSeries(anime.name, info);

      if (mapping?.mappedSeason != null && mapping?.mappedEpisode != null) {
        mappedInfo = {
          ...info,
          season: mapping.mappedSeason,
          episode: mapping.mappedEpisode
        };
      }
    }

    const tmdb = await fetchTMDBSeries(anime.name, mappedInfo, token);

    return {
      name: tmdb?.episodeName
        ? `${anime.name} - ${tmdb.episodeName}`
        : displayTitle(anime.name, info),

      poster: anime.poster,
      background: anime.background,

      description:
        tmdb?.episodeDescription ||
        tmdb?.description ||
        anime.description ||
        "",

      releaseInfo:
        tmdb?.episodeReleased?.slice(0, 4) ||
        anime.releaseInfo,

      genres: anime.genres || []
    };
  }

  // 2. TV series: Cinemeta artwork.
  const series = await fetchSeries(info.title, info);

  if (series) {
    let mappedInfo = info;

    if (
      info.absoluteEpisode !== null &&
      series.mappedSeason != null &&
      series.mappedEpisode != null
    ) {
      mappedInfo = {
        ...info,
        season: series.mappedSeason,
        episode: series.mappedEpisode
      };
    }

    const tmdb = await fetchTMDBSeries(info.title, mappedInfo, token);

    const episodeName = tmdb?.episodeName || series.episodeName;

    return {
      name: episodeName
        ? `${series.name} - ${episodeName}`
        : displayTitle(series.name, info),

      poster: series.poster,
      background: series.background,

      description:
        tmdb?.episodeDescription ||
        series.episodeDescription ||
        tmdb?.description ||
        series.description ||
        "",

      releaseInfo:
        tmdb?.episodeReleased?.slice(0, 4) ||
        series.releaseInfo,

      genres: series.genres || tmdb?.genres || []
    };
  }

  // 3. TMDB TV fallback.
  const tmdbSeries = await fetchTMDBSeries(info.title, info, token);

  if (tmdbSeries) {
    return {
      name: tmdbSeries.episodeName
        ? `${tmdbSeries.name} - ${tmdbSeries.episodeName}`
        : displayTitle(tmdbSeries.name, info),

      poster: tmdbSeries.poster,
      background: tmdbSeries.background,

      description:
        tmdbSeries.episodeDescription ||
        tmdbSeries.description ||
        "",

      releaseInfo:
        tmdbSeries.episodeReleased?.slice(0, 4) ||
        tmdbSeries.releaseInfo,

      genres: tmdbSeries.genres || []
    };
  }

  // 4. Movie.
  const tmdbMovie = await fetchTMDBMovie(info.title, token);
  if (tmdbMovie) return tmdbMovie;

  const movie = await fetchMovie(info.title);
  if (movie) return movie;

  return fallback;
}

async function getMetadata(videoUrl, token) {
  const metadata = await getMetadataRaw(videoUrl, token);

  metadata.description = await translateArabic(metadata.description);

  return metadata;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    const token = env.TMDB_TOKEN;

    if (path === "/manifest.json") {
      return json({
        id: "com.nuvio.directplayer",
        version: "1.3.0",
        name: "Nuvio Stream",
        description: "Play direct video links with automatic metadata",
        resources: ["catalog", "meta", "stream"],
        types: ["movie"],
        idPrefixes: ["direct:"],
        catalogs: [{
          type: "movie",
          id: "direct",
          name: "Nuvio Stream",
          extra: [{
            name: "search",
            isRequired: true
          }]
        }]
      });
    }

    if (path.startsWith("/catalog/movie/direct/")) {
      const extra = path
        .slice("/catalog/movie/direct/".length)
        .replace(/\.json$/, "");

      const input = new URLSearchParams(extra).get("search") || "";

      if (!validUrl(input)) return json({ metas: [] });

      const id = "direct:" + encodeId(input);
      const metadata = await getMetadata(input, token);

      return json({
        metas: [{
          id,
          type: "movie",
          name: metadata.name,
          poster: metadata.poster,
          background: metadata.background,
          description: metadata.description
        }]
      });
    }

    if (path.startsWith("/meta/movie/")) {
      const rawId = path.split("/").pop().replace(/\.json$/, "");
      const itemId = decodeItemId(rawId);

      if (!itemId.startsWith("direct:")) {
        return json({ meta: null });
      }

      let videoUrl;

      try {
        videoUrl = decodeId(itemId.slice(7));
      } catch {
        return json({ meta: null });
      }

      if (!validUrl(videoUrl)) return json({ meta: null });

      const metadata = await getMetadata(videoUrl, token);

      return json({
        meta: {
          id: itemId,
          type: "movie",
          name: metadata.name,
          poster: metadata.poster,
          background: metadata.background,
          description: metadata.description,
          releaseInfo: metadata.releaseInfo,
          genres: metadata.genres,
          videos: [{
            id: itemId,
            title: "Play Video"
          }]
        }
      });
    }

    if (path.startsWith("/stream/movie/")) {
      const rawId = path.split("/").pop().replace(/\.json$/, "");
      const itemId = decodeItemId(rawId);

      if (!itemId.startsWith("direct:")) {
        return json({ streams: [] });
      }

      let videoUrl;

      try {
        videoUrl = decodeId(itemId.slice(7));
      } catch {
        return json({ streams: [] });
      }

      if (!validUrl(videoUrl)) return json({ streams: [] });

      return json({
        streams: [{
          name: "Nuvio Stream",
          title: "Play Video",
          url: videoUrl,
          behaviorHints: {
            notWebReady: false
          }
        }]
      });
    }

    return json({ error: "Not found" });
  }
};
