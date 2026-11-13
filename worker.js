const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const animeCache = new Map();
const movieCache = new Map();

function json(data) {
  return new Response(JSON.stringify(data), { headers: cors });
}

function encodeId(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

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
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getFilename(videoUrl) {
  try {
    const url = new URL(videoUrl);
    return decodeURIComponent(url.pathname.split("/").pop() || "");
  } catch {
    return "Direct Video";
  }
}

function parseFilename(filename) {
  let name = filename.replace(/\.[^.]+$/, "");

  name = name
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(?:1080p|720p|2160p|WEB-DL|BluRay)[^)]*\)/gi, " ")
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

function formatTitle(info, original) {
  if (info.season !== null && info.episode !== null) {
    return `${info.title} - S${String(info.season).padStart(2, "0")}E${String(info.episode).padStart(2, "0")}`;
  }

  return info.title || original;
}

async function fetchAnime(title) {
  if (animeCache.has(title)) {
    return animeCache.get(title);
  }

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
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
    const media = data?.data?.Media;

    if (!media) return null;

    const result = {
      name: media.title.english || media.title.romaji || title,
      poster: media.coverImage.extraLarge || media.coverImage.large,
      background: media.bannerImage || undefined,
      description: media.description || "",
      releaseInfo: media.seasonYear ? String(media.seasonYear) : undefined,
      genres: media.genres || []
    };

    animeCache.set(title, result);
    return result;
  } catch {
    return null;
  }
}

async function fetchCinemeta(title, type) {
  const key = `${type}:${title}`;

  if (movieCache.has(key)) {
    return movieCache.get(key);
  }

  try {
    const url =
      `https://v3-cinemeta.strem.io/catalog/${type}/top/search=${encodeURIComponent(title)}.json`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) return null;

    const data = await response.json();
    const metas = data?.metas || [];

    if (!metas.length) return null;

    const normalize = value =>
      (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    const wanted = normalize(title);

    let best = metas.find(item =>
      normalize(item.name) === wanted
    );

    if (!best) {
      best = metas.find(item =>
        normalize(item.name).includes(wanted) ||
        wanted.includes(normalize(item.name))
      );
    }

    if (!best) best = metas[0];

    const result = {
      name: best.name || title,
      poster: best.poster || undefined,
      background: best.background || undefined,
      description: best.description || "",
      releaseInfo: best.releaseInfo || undefined,
      genres: best.genres || []
    };

    movieCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

async function getMetadata(videoUrl) {
  const filename = getFilename(videoUrl);
  const info = parseFilename(filename);

  const fallback = {
    name: formatTitle(info, filename),
    description: `Original file: ${filename}`
  };

  // Try anime database first
  const anime = await fetchAnime(info.title);

  if (anime) {
    return {
      ...fallback,
      ...anime,
      name: formatTitle({
        ...info,
        title: anime.name
      }, filename),
      description:
        `${fallback.name}\n\n${anime.description || ""}`
    };
  }

  // Try movie database
  const movie = await fetchCinemeta(info.title, "movie");

  // Try TV series database
  const series = await fetchCinemeta(info.title, "series");

  const result = movie || series;

  if (result) {
    return {
      ...fallback,
      ...result,
      name: formatTitle({
        ...info,
        title: result.name
      }, filename),
      description:
        `${fallback.name}\n\n${result.description || ""}`
    };
  }

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
        version: "1.0.4",
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

    // Catalog Search
    if (path.startsWith("/catalog/movie/direct/")) {
      const extra = path
        .slice("/catalog/movie/direct/".length)
        .replace(/\.json$/, "");

      const params = new URLSearchParams(extra);
      const input = params.get("search") || "";

      if (!validUrl(input)) {
        return json({ metas: [] });
      }

      const id = "direct:" + encodeId(input);
      const filename = getFilename(input);
      const info = parseFilename(filename);
      const metadata = await getMetadata(input);

      return json({
        metas: [{
          id,
          type: "movie",
          name: metadata.name || info.title,
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

      if (!validUrl(videoUrl)) {
        return json({ meta: null });
      }

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

      if (!validUrl(videoUrl)) {
        return json({ streams: [] });
      }

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
