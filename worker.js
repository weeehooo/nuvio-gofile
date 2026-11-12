const VIDEO_URL = "https://4.gofile.io/download/direct/7b2a1d86-7e34-48c7-a516-04d09dda2212/%5BSylor%5D%20Cyberpunk%20-%20Edgerunners%20-%2004%20-%204K.mkv";

const VIDEO_ID = "gofile-cyberpunk-04";

const manifest = {
  id: "com.nuvio.gofile",
  version: "1.0.0",
  name: "Gofile Direct",
  description: "Play direct Gofile video links",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["gofile-"],
  catalogs: [{
    type: "movie",
    id: "gofile",
    name: "Gofile Videos"
  }]
};

function response(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/" || path === "/manifest.json") {
      return response(manifest);
    }

    if (path === "/catalog/movie/gofile.json") {
      return response({
        metas: [{
          id: VIDEO_ID,
          type: "movie",
          name: "Cyberpunk Edgerunners Episode 04 4K"
        }]
      });
    }

    if (path === `/meta/movie/${VIDEO_ID}.json`) {
      return response({
        meta: {
          id: VIDEO_ID,
          type: "movie",
          name: "Cyberpunk Edgerunners Episode 04 4K"
        }
      });
    }

    if (path === `/stream/movie/${VIDEO_ID}.json`) {
      return response({
        streams: [{
          name: "Gofile Direct",
          title: "4K MKV",
          url: VIDEO_URL,
          behaviorHints: {
            notWebReady: true
          }
        }]
      });
    }

    return response({});
  }
};
