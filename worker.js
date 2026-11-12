const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data) {
  return new Response(JSON.stringify(data), { headers: cors });
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // Addon manifest
    if (path === "/manifest.json") {
      return json({
        id: "com.nuvio.directplayer",
        version: "1.0.1",
        name: "Direct Video Player",
        description: "Play direct video links",
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

    // Search catalog
    if (path.startsWith("/catalog/movie/direct")) {
      const input = url.searchParams.get("search") || "";

      if (!/^https?:\/\//i.test(input)) {
        return json({ metas: [] });
      }

      const id = "direct:" + encodeURIComponent(input);

      return json({
        metas: [{
          id,
          type: "movie",
          name: "Direct Video",
          description: "Custom video link"
        }]
      });
    }

    // Metadata
    if (path.startsWith("/meta/movie/")) {
      const encodedId = path.split("/").pop().replace(".json", "");
      const id = decode(encodedId);

      return json({
        meta: {
          id,
          type: "movie",
          name: "Direct Video",
          videos: [{
            id,
            title: "Play Video"
          }]
        }
      });
    }

    // Video stream
    if (path.startsWith("/stream/movie/")) {
      const encodedId = path.split("/").pop().replace(".json", "");
      const id = decode(encodedId);

      const video = decode(id.slice("direct:".length));

      if (!/^https?:\/\//i.test(video)) {
        return json({ streams: [] });
      }

      return json({
        streams: [{
          name: "Direct Video",
          title: "Play Video",
          url: video,
          behaviorHints: {
            notWebReady: false
          }
        }]
      });
    }

    return json({ error: "Not found" });
  }
};
