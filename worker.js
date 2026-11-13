const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const cache = new Map();

const TMDB_LANGUAGE = "ar-SA";
const TMDB_SEARCH_LANGUAGE = "en-US";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/original";

const ARABIC_FALLBACK = "لا يتوفر وصف عربي لهذا العمل حاليًا.";

function json(data) {
  return new Response(JSON.stringify(data), { headers: cors });
}

function encodeId(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeId(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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
    const u = new URL(videoUrl);
    return decodeURIComponent(u.pathname.split("/").pop() || "");
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
  const first = normalize(a);
  const second = normalize(b);
  return first.length > 0 && first === second;
}

function titleMatchScore(input, candidate) {
  const a = normalize(input);
  const b = normalize(candidate);

  if (!a || !b) return 0;
  if (a === b) return 100;

  if (a.length >= 4 && b.length >= 4) {
    if (a.includes(b) || b.includes(a)) return 85;
  }

  const wordsA = (input || "")
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter(Boolean);

  const wordsB = (candidate || "")
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (!wordsA.length || !wordsB.length) return 0;

  const matched = wordsA.filter(word =>
    wordsB.some(other =>
      normalize(word) === normalize(other)
    )
  ).length;

  return Math.round(
    (matched / Math.max(wordsA.length, wordsB.length)) * 75
  );
}

function cleanFilenameTitle(value) {
  return (value || "")
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(?:1080p|720p|2160p|480p|4k|8k|web|bluray|hevc|x265|x264)[^)]*\)/gi, " ")
    .replace(/\b(2160p|1080p|720p|480p|4k|8k|WEB-DL|WEBRip|WEB|BluRay|BDRip|BRRip|HEVC|H265|H264|x265|x264|AAC|DTS|10bit|HDR|NF|AMZN|DSNP|CR|ATVP)\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .trim();
}

function parseFilename(filename) {
  let name = filename.replace(/\.[^.]+$/, "");
  name = cleanFilenameTitle(name);

  let season = null;
  let episode = null;
  let absoluteEpisode = null;
  let title = name;

  let match = name.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);

  if (match) {
    season = Number(match[1]);
    episode = Number(match[2]);
    title = name.slice(0, match.index).trim();
  } else {
    match = name.match(/\bSeason\s*(\d{1,2})\s*[-._ ]*\s*(?:Episode\s*)?(\d{1,3})\b/i);

    if (match) {
      season = Number(match[1]);
      episode = Number(match[2]);
      title = name.slice(0, match.index).trim();
    } else {
      match = name.match(/\b(\d{1,2})x(\d{1,3})\b/i);

      if (match) {
        season = Number(match[1]);
        episode = Number(match[2]);
        title = name.slice(0, match.index).trim();
      } else {
        match = name.match(/(?:^|[\s._-])[-._ ]*(\d{1,4})(?:v\d+)?\s*$/i);

        if (match) {
          const number = Number(match[1]);
          const before = name.slice(0, match.index).trim();

          const isLikelyEpisode =
            number >= 1 &&
            number <= 9999 &&
            before.length >= 2 &&
            !(number >= 1900 && number <= 2099 && match[1].length === 4);

          if (isLikelyEpisode) {
            absoluteEpisode = number;
            title = before;
          }
        }
      }
    }
  }

  title = title
    .replace(/[-_. ]+$/, "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || name || "Direct Video",
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

// Translate descriptions only. Never translate titles or episode names.
async function translateArabic(text) {
  if (!text || !text.trim()) return ARABIC_FALLBACK;

  // Already Arabic with no English letters.
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasEnglish = /[A-Za-z]/.test(text);

  if (hasArabic && !hasEnglish) return text;

  try {
    const chunks = text.match(/[\s\S]{1,4000}/g) || [];
    const translated = [];

    for (const chunk of chunks) {
      const url =
        "https://translate.googleapis.com/translate_a/single" +
        "?client=gtx&sl=auto&tl=ar&dt=t&q=" +
        encodeURIComponent(chunk);

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error("Translation failed");
      }

      const data = await response.json();

      const result = (data[0] || [])
        .map(part => part[0] || "")
        .join("");

      if (!result.trim()) {
        throw new Error("Empty translation");
      }

      translated.push(result);
    }

    const output = translated.join("").trim();

    if (!/[\u0600-\u06FF]/.test(output)) {
      return ARABIC_FALLBACK;
    }

    return output;
  } catch {
    // Do not expose English descriptions if translation fails.
    return hasArabic ? text : ARABIC_FALLBACK;
  }
}

async function tmdbFetch(endpoint, token) {
  if (!token) return null;

  try {
    const response = await fetch(
      `https://api.themoviedb.org/3${endpoint}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchTMDBSeries(title, info, token) {
  const key = `tmdb-series:${title}:${info.season}:${info.episode}`;

  if (cache.has(key)) return cache.get(key);

  const search = await tmdbFetch(
    `/search/tv?query=${encodeURIComponent(title)}&language=${TMDB_SEARCH_LANGUAGE}&include_adult=false`,
    token
  );

  const results = search?.results || [];

  const match = results.find(item =>
    exactMatch(title, item.name) ||
    exactMatch(title, item.original_name)
  );

  if (!match) return null;

  const details = await tmdbFetch(
    `/tv/${match.id}?language=${TMDB_LANGUAGE}`,
    token
  );

  if (!details) return null;

  let episode = null;

  if (info.season !== null && info.episode !== null) {
    episode = await tmdbFetch(
      `/tv/${match.id}/season/${info.season}/episode/${info.episode}?language=${TMDB_LANGUAGE}`,
      token
    );
  }

  const result = {
    name: match.original_name || match.name || title,
    poster: tmdbImage(details.poster_path || match.poster_path),
    background: tmdbImage(details.backdrop_path || match.backdrop_path),
    description: details.overview || match.overview || "",
    episodeName: episode?.name || null,
    episodeDescription: episode?.overview || null,
    episodeReleased: episode?.air_date || null,
    releaseInfo: details.first_air_date
      ? details.first_air_date.slice(0, 4)
      : undefined,
    genres: (details.genres || []).map(g => g.name)
  };

  cache.set(key, result);
  return result;
}

async function fetchTMDBMovie(title, token) {
  const key = `tmdb-movie:${title}`;

  if (cache.has(key)) return cache.get(key);

  const search = await tmdbFetch(
    `/search/movie?query=${encodeURIComponent(title)}&language=${TMDB_SEARCH_LANGUAGE}&include_adult=false`,
    token
  );

  const results = search?.results || [];

  const match = results.find(item =>
    exactMatch(title, item.title) ||
    exactMatch(title, item.original_title)
  );

  if (!match) return null;

  const details = await tmdbFetch(
    `/movie/${match.id}?language=${TMDB_LANGUAGE}`,
    token
  );

  if (!details) return null;

  const result = {
    name: match.original_title || match.title || title,
    poster: tmdbImage(details.poster_path || match.poster_path),
    background: tmdbImage(details.backdrop_path || match.backdrop_path),
    description: details.overview || match.overview || "",
    releaseInfo: details.release_date
      ? details.release_date.slice(0, 4)
      : undefined,
    genres: (details.genres || []).map(g => g.name)
  };

  cache.set(key, result);
  return result;
}

// AniList: English, Romaji, Japanese and alternate titles.
async function fetchAnime(title) {
  const key = "anime:" + title;

  if (cache.has(key)) return cache.get(key);

  const query = `
    query ($search: String) {
      Page(perPage: 25) {
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

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: { search: title }
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const results = data?.data?.Page?.media || [];

    let bestMatch = null;
    let bestScore = 0;

    for (const item of results) {
      const titles = [
        item.title?.english,
        item.title?.romaji,
        item.title?.native,
        ...(item.synonyms || [])
      ].filter(Boolean);

      let score = 0;

      for (const candidate of titles) {
        score = Math.max(
          score,
          titleMatchScore(title, candidate)
        );
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }

    if (!bestMatch || bestScore < 65) return null;

    const result = {
      name:
        bestMatch.title?.english ||
        bestMatch.title?.romaji ||
        title,

      poster:
        bestMatch.coverImage?.extraLarge ||
        bestMatch.coverImage?.large,

      background:
        bestMatch.bannerImage || undefined,

      description:
        bestMatch.description || "",

      releaseInfo:
        bestMatch.seasonYear
          ? String(bestMatch.seasonYear)
          : undefined,

      genres:
        bestMatch.genres || []
    };

    cache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

async function fetchSeries(title, info) {
  const key = `series:${title}:${info.season}:${info.episode}:${info.absoluteEpisode}`;

  if (cache.has(key)) return cache.get(key);

  try {
    const searchUrl =
      `https://v3-cinemeta.strem.io/catalog/series/top/search=${encodeURIComponent(title)}.json`;

    const searchResponse = await fetch(searchUrl, {
      signal: AbortSignal.timeout(6000)
    });

    if (!searchResponse.ok) return null;

    const searchData = await searchResponse.json();
    const metas = searchData?.metas || [];

    const match = metas.find(item =>
      exactMatch(title, item.name)
    );

    if (!match) return null;

    const metaUrl =
      `https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(match.id)}.json`;

    const metaResponse = await fetch(metaUrl, {
      signal: AbortSignal.timeout(6000)
    });

    if (!metaResponse.ok) return null;

    const metaData = await metaResponse.json();
    const series = metaData?.meta;

    if (!series) return null;

    let episode = null;

    if (info.season !== null && info.episode !== null) {
      episode = (series.videos || []).find(video =>
        Number(video.season) === info.season &&
        Number(video.episode) === info.episode
      );
    }

    if (!episode && info.absoluteEpisode !== null) {
      episode = (series.videos || []).find(video =>
        Number(video.episode) === info.absoluteEpisode ||
        Number(video.number) === info.absoluteEpisode
      );
    }

    const result = {
      name: series.name || title,
      poster: series.poster || undefined,
      background: series.background || undefined,
      description: series.description || "",
      releaseInfo: series.releaseInfo || undefined,
      genres: series.genres || [],
      episodeName: episode?.title || null,
      episodeDescription: episode?.overview || null,
      episodeReleased: episode?.released || null,

      mappedSeason: episode?.season != null
        ? Number(episode.season)
        : null,

      mappedEpisode: episode?.episode != null
        ? Number(episode.episode)
        : null
    };

    cache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

async function fetchMovie(title) {
  const key = "movie:" + title;

  if (cache.has(key)) return cache.get(key);

  try {
    const endpoint =
      `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(title)}.json`;

    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const metas = data?.metas || [];

    const match = metas.find(item =>
      exactMatch(title, item.name)
    );

    if (!match) return null;

    const result = {
      name: match.name,
      poster: match.poster || undefined,
      background: match.background || undefined,
      description: match.description || "",
      releaseInfo: match.releaseInfo || undefined,
      genres: match.genres || []
    };

    cache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

async function getMetadataRaw(videoUrl, token) {
  const filename = getFilename(videoUrl);
  const info = parseFilename(filename);

  const fallback = {
    name: displayTitle(info.title, info),
    description: ""
  };

  // 1. Anime: AniList owns anime artwork.
  const anime = await fetchAnime(info.title);

  if (anime) {
    let tmdbInfo = info;

    if (
      info.absoluteEpisode !== null &&
      (info.season === null || info.episode === null)
    ) {
      const mapping = await fetchSeries(anime.name, info);

      if (
        mapping?.mappedSeason !== null &&
        mapping?.mappedSeason !== undefined &&
        mapping?.mappedEpisode !== null &&
        mapping?.mappedEpisode !== undefined
      ) {
        tmdbInfo = {
          ...info,
          season: mapping.mappedSeason,
          episode: mapping.mappedEpisode
        };
      }
    }

    const tmdb = await fetchTMDBSeries(
      anime.name,
      tmdbInfo,
      token
    );

    const episodeName = tmdb?.episodeName || null;

    return {
      name: episodeName
        ? `${anime.name} - ${episodeName}`
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

  // 2. TV series: Cinemeta owns series artwork.
  const series = await fetchSeries(info.title, info);

  if (series) {
    let tmdbInfo = info;

    if (
      info.absoluteEpisode !== null &&
      series.mappedSeason !== null &&
      series.mappedEpisode !== null
    ) {
      tmdbInfo = {
        ...info,
        season: series.mappedSeason,
        episode: series.mappedEpisode
      };
    }

    const tmdb = await fetchTMDBSeries(
      info.title,
      tmdbInfo,
      token
    );

    const episodeName =
      tmdb?.episodeName ||
      series.episodeName ||
      null;

    const episodeDescription =
      tmdb?.episodeDescription ||
      series.episodeDescription ||
      null;

    return {
      name: episodeName
        ? `${series.name} - ${episodeName}`
        : displayTitle(series.name, info),

      poster: series.poster,
      background: series.background,

      description:
        episodeDescription ||
        tmdb?.description ||
        series.description ||
        "",

      releaseInfo:
        tmdb?.episodeReleased?.slice(0, 4) ||
        series.releaseInfo,

      genres: series.genres || tmdb?.genres || []
    };
  }

  // 3. TMDB-only TV fallback.
  const tmdbSeries = await fetchTMDBSeries(
    info.title,
    info,
    token
  );

  if (tmdbSeries) {
    const episodeName = tmdbSeries.episodeName;

    return {
      name: episodeName
        ? `${tmdbSeries.name} - ${episodeName}`
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

  // 4. Movie metadata.
  const tmdbMovie = await fetchTMDBMovie(info.title, token);

  if (tmdbMovie) return tmdbMovie;

  const movie = await fetchMovie(info.title);

  if (movie) return movie;

  return fallback;
}

// Translate descriptions only. Names remain unchanged.
async function getMetadata(videoUrl, token) {
  const metadata = await getMetadataRaw(videoUrl, token);

  metadata.description = await translateArabic(
    metadata.description
  );

  return metadata;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const token = env.TMDB_TOKEN;

    // Manifest
    if (path === "/manifest.json") {
      return json({
        id: "com.nuvio.directplayer",
        version: "1.2.1",
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

    // Catalog
    if (path.startsWith("/catalog/movie/direct/")) {
      const extra = path
        .slice("/catalog/movie/direct/".length)
        .replace(/\.json$/, "");

      const params = new URLSearchParams(extra);
      const input = params.get("search") || "";

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

    // Metadata
    if (path.startsWith("/meta/movie/")) {
      const rawId = path.split("/").pop().replace(/\.json$/, "");
      const itemId = decodeItemId(rawId);

      if (!itemId.startsWith("direct:")) {
        return json({ meta: null });
      }

      let videoUrl;

      try {
        videoUrl = decodeId(itemId.slice("direct:".length));
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

    // Stream
    if (path.startsWith("/stream/movie/")) {
      const rawId = path.split("/").pop().replace(/\.json$/, "");
      const itemId = decodeItemId(rawId);

      if (!itemId.startsWith("direct:")) {
        return json({ streams: [] });
      }

      let videoUrl;

      try {
        videoUrl = decodeId(itemId.slice("direct:".length));
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
