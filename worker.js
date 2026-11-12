const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

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

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    if (path === "/manifest.json") {
      return json({
        id: "com.nuvio.directplayer",
        version: "1.0.2",
        name: "Direct Video Player",
        description: "Play your own direct video links",
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

    // Search: /catalog/movie/direct/search=<encoded URL>.json
    if (path.startsWith("/catalog/movie/direct/")) {
      const extra = path.slice("/catalog/movie/direct/".length)
        .replace(/\.json$/, "");

      const params = new URLSearchParams(extra);
      const input = params.get("search") || "";

      if (!validUrl(input)) {
        return json({ metas: [] });
      }

      const id = "direct:" + encodeId(input);

      return json({
        metas: [{
          id,
          type: "movie",
          name: "Direct Video",
          description: input
        }]
      });
    }

    // Metadata
    if (path.startsWith("/meta/movie/")) {
      const itemId = path.split("/").pop().replace(/\.json$/, "");

      if (!itemId.startsWith("direct:")) {
        return json({ meta: null });
      }

      let videoUrl;
      try {
        videoUrl = decodeId(itemId.slice("direct:".length));
      } catch {
        return json({ meta: null });
      }

      return json({
        meta: {
          id: itemId,
          type: "movie",
          name: "Direct Video",
          description: videoUrl,
          videos: [{
            id: itemId,
            title: "Play Video"
          }]
        }
      });
    }

    // Stream
    if (path.startsWith("/stream/movie/")) {
      const itemId = path.split("/").pop().replace(/\.json$/, "");

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
