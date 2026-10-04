// Development-only bridge for browser QA. Packaged builds use validated Electron IPC.
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomBytes } = require("node:crypto");
const { DesktopController } = require("../src/controller.cjs");
const repository = path.resolve(__dirname, "../.."),
  resources = path.join(repository, "desktop/resources");
const devConfig = JSON.parse(
  fs.readFileSync(path.join(repository, ".vibepod/config.json"), "utf8").replace(/^\uFEFF/, "")
);
const sessions = new Set(),
  subscribers = new Set(),
  port = Number(process.env.VIBEPOD_DESKTOP_REVIEW_PORT || 3019),
  origin = `http://127.0.0.1:${port}`;
const c = new DesktopController({
  root: path.join(repository, ".vibepod/desktop-review"),
  resources,
  node: process.env.VIBEPOD_DESKTOP_NODE || process.execPath,
  helpers: pathToFileURL(path.join(resources, "helpers/dev.mjs")).href,
  devConfig,
  onState: (state) => {
    for (const response of subscribers)
      response.write(`data: ${JSON.stringify({ ...state, browserReview: true })}\n\n`);
  },
});
const bridge = `window.vibepod={state:()=>fetch('/api/state').then(r=>r.json()),onState:callback=>{const source=new EventSource('/events');source.onmessage=e=>callback(JSON.parse(e.data));return()=>source.close()},chooseFolder:()=>Promise.reject(new Error('Use the desktop app for the native Windows folder picker.')),install:settings=>call('install',settings),pause:()=>call('pause'),repair:()=>call('repair'),retry:()=>call('retry'),start:()=>call('start').then(result=>{if(result.url)location.href=result.url}),driverHelp:()=>Promise.reject(new Error('Open official NVIDIA guidance from the desktop app.'))};async function call(action,settings){const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,settings})});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}`;
const server = http.createServer(async (request, response) => {
  if (request.headers.host !== `127.0.0.1:${port}`) {
    response.writeHead(403);
    response.end();
    return;
  }
  const url = new URL(request.url, origin),
    cookie = request.headers.cookie?.match(/vibepod_review=([a-f0-9]+)/)?.[1];
  if (url.pathname === "/" && request.method === "GET") {
    const token = randomBytes(32).toString("hex");
    sessions.add(token);
    response.setHeader("Set-Cookie", `vibepod_review=${token}; HttpOnly; SameSite=Strict; Path=/`);
    const html = fs
      .readFileSync(path.join(repository, "desktop/ui/index.html"), "utf8")
      .replace(
        '<script src="renderer.js"></script>',
        '<script src="bridge.js"></script><script src="renderer.js"></script>'
      );
    response.setHeader("Content-Type", "text/html");
    response.end(html);
    return;
  }
  if (!sessions.has(cookie)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (url.pathname === "/events") {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    response.write(`data: ${JSON.stringify({ ...c.state, browserReview: true })}\n\n`);
    subscribers.add(response);
    request.on("close", () => subscribers.delete(response));
    return;
  }
  if (url.pathname === "/api/state") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ...c.state, browserReview: true }));
    return;
  }
  if (url.pathname === "/api/action") {
    if (
      request.method !== "POST" ||
      request.headers.origin !== origin ||
      request.headers["content-type"] !== "application/json"
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      let text = "";
      for await (const chunk of request) {
        text += chunk;
        if (text.length > 16384) throw new Error("Request too large");
      }
      const { action, settings } = JSON.parse(text);
      const actions = {
        install: () => c.install(settings),
        pause: () => c.pause(),
        repair: () => c.install(c.state.settings, c.state.error?.kind !== "download"),
        retry: () => c.check(),
        start: async () => ({ url: await c.start() }),
      };
      if (!Object.hasOwn(actions, action)) throw new Error("Unknown action");
      const result = await actions[action]();
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result || {}));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }
  const assets = {
    "/style.css": "text/css",
    "/renderer.js": "application/javascript",
    "/bridge.js": "application/javascript",
  };
  if (assets[url.pathname]) {
    response.setHeader("Content-Type", assets[url.pathname]);
    response.end(
      url.pathname === "/bridge.js"
        ? bridge
        : fs.readFileSync(path.join(repository, "desktop/ui", url.pathname.slice(1)))
    );
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(port, "127.0.0.1", async () => {
  console.log(`Desktop browser QA: ${origin}`);
  await c.check();
});
async function stop() {
  await c.stop();
  for (const response of subscribers) response.end();
  server.close();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
