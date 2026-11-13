const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const cache = new Map();

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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseFilename(filename) {
  let name = filename.replace(/\.[^.]+$/, "");

  name = name
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(2160p|1080p|720p|480p|4k|8k|WEB-DL|WEBRip|BluRay|BDRip|HEVC|H265|H264|x265|x264|AAC|DTS|10bit|HDR)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  let season = null;
  let episode = null;
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
      }
    }
  }

  title = title
    .replace(/[-_. ]+$/, "")
    .replace(/[._]/g, " ")
    .trim();

  return {
    title: title || name || "Direct Video",
    season,
    episode
  };
}

function displayTitle(title, info) {
  if (info.season !== null && info.episode !== null) {
    return `${title} - S${String(info.season).padStart(2, "0")}E${String(info.episode).padStart(2, "0")}`;
  }

  return title;
}

function exactMatch(info, title) {
  const wanted = normalize(info);
  const candidate = normalize(title);

  return wanted.length > 0 && candidate === wanted;
}

async function fetchAnime(title) {
  const key = "anime:" + title;
  if (cache.has(key)) return cache.get(key);

  const query = `
    query ($search: String) {
      Page(perPage: 10) {
        media(search: $search, type: ANIME) {
          title {
            romaji
            english
            native
          }
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
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const results = data?.data?.Page?.media || [];

    const match = results.find(item =>
      exactMatch(title, item.title.english) ||
      exactMatch(title, item.title.romaji) ||
      exactMatch(title, item.title.native)
    );

    if (!match) return null;

    const result = {
      name: match.title.english || match.title.romaji || title,
      poster: match.coverImage?.extraLarge || match.coverImage?.large,
      background: match.bannerImage || undefined,
      description: match.description || "",
      releaseInfo: match.seasonYear ? String(match.seasonYear) : undefined,
      genres: match.genres || []
    };

    cache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

async function fetchCinemeta(title, type) {
  const key = `${type}:${title}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const endpoint =
      `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(title)}.json`;

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

async function getMetadata(videoUrl) {
  const filename = getFilename(videoUrl);
  const info = parseFilename(filename);

  const fallback = {
    name: displayTitle(info.title, info),
    description: `Original file: ${filename}`
  };

  // Anime lookup
  const anime = await fetchAnime(info.title);

  if (anime) {
    return {
      ...anime,
      name: displayTitle(anime.name, info),
      description: `${fallback.name}\n\n${anime.description}`
    };
  }

  // TV series lookup
  const series = await fetchCinemeta(info.title, "series");

  if (series) {
    return {
      ...series,
      name: displayTitle(series.name, info),
      description: `${fallback.name}\n\n${series.description}`
    };
  }

  // Movie lookup
  const movie = await fetchCinemeta(info.title, "movie");

  if (movie) {
    return {
      ...movie,
      name: movie.name,
      description: movie.description
    };
  }

  // No reliable match: use original filename
  return fallback;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // Manifest
    if (path === "/manifest.json") {
      return json({
        id: "com.nuvio.directplayer",
        version: "1.0.5",
        name: "Direct Video Player",
        description: "Play direct video links with automatic metadata",
        resources: ["catalog", "meta", "stream"],
        types: ["movie"],
        idPrefixes: ["direct:"],
        catalogs: [{
          type: "movie",
          id: "direct",
          name: "Direct Video Player",
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
      const metadata = await getMetadata(input);

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

      const metadata = await getMetadata(videoUrl);

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
          name: "Direct Video Player",
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
