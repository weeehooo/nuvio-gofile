const cors = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data) {
  return new Response(JSON.stringify(data), { headers: cors });
}

function decode(value) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/manifest.json") {
      return json({
        id: "com.nuvio.directplayer",
        version: "1.0.0",
        name: "Direct Video Player",
        description: "Play your own direct video links",
        resources: ["catalog", "meta", "stream"],
        types: ["movie"],
        idPrefixes: ["direct:"],
        catalogs: [{
          type: "movie",
          id: "direct",
          name: "Direct Video Player",
          extra: [{ name: "search", isRequired: true }]
        }]
      });
    }

    if (path.startsWith("/catalog/movie/direct")) {
      let input = url.searchParams.get("search") || "";
      const match = path.match(/search=(.*)\.json$/);
      if (match) input = decode(match[1]);

      if (!input || !/^https?:\/\//i.test(input)) {
        return json({ metas: [] });
      }

      const id = "direct:" + encodeURIComponent(input);

      return json({
        metas: [{
          id,
          type: "movie",
          name: "Direct Video",
          description: input
        }]
      });
    }

    if (path.startsWith("/meta/movie/")) {
      const id = decode(path.split("/").pop().replace(".json", ""));
      const video = id.slice("direct:".length);
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

    if (path.startsWith("/stream/movie/")) {
      const id = decode(path.split("/").pop().replace(".json", ""));
      const video = id.slice("direct:".length);

      return json({
        streams: [{
          name: "Direct Link",
          title: "Play Video",
          url: video
        }]
      });
    }

    return json({ error: "Not found" });
  }
};
