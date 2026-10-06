import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertPortAvailable,
  loadConfig,
  lockHash,
  startChild,
  stopChild,
  waitReady,
} from "../dev.mjs";

test("occupied port is reported without stopping its owner", async () => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await assert.rejects(assertPortAvailable(server.address().port), /occupied/);
    assert.equal(server.listening, true);
  } finally {
    server.close();
  }
});

test("readiness succeeds and owned child stops; early exit fails promptly", async () => {
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const child = startChild("fixture", process.execPath, [
    path.resolve("scripts/tests/fixture.mjs"),
    String(port),
  ]);
  try {
    await waitReady(`http://127.0.0.1:${port}`, child, 5000);
    const closed = once(child, "close");
    stopChild(child);
    await closed;
    await assertPortAvailable(port);
    await assert.rejects(
      waitReady(`http://127.0.0.1:${port}`, child, 5000),
      /exited before readiness/
    );
  } finally {
    stopChild(child);
  }
});

test("setup stamp detects changed dependencies and invalid port configuration", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "vibepod-launcher-"));
  try {
    mkdirSync(path.join(directory, "server"));
    mkdirSync(path.join(directory, ".vibepod"));
    writeFileSync(path.join(directory, "server/uv.lock"), "python lock");
    writeFileSync(path.join(directory, "pnpm-lock.yaml"), "node lock");
    const config = {
      modelPath: directory,
      designModelPath: directory,
      hfHome: directory,
      python: process.execPath,
      backendPort: 8000,
      webPort: 3000,
      lockHash: lockHash(directory),
    };
    const file = path.join(directory, ".vibepod/config.json");
    writeFileSync(file, "\uFEFF" + JSON.stringify(config));
    assert.equal(loadConfig(directory).webPort, 3000);
    writeFileSync(file, JSON.stringify({ ...config, webPort: 8000 }));
    assert.throws(() => loadConfig(directory), /different/);
    writeFileSync(file, JSON.stringify(config));
    writeFileSync(path.join(directory, "server/uv.lock"), "changed lock");
    assert.throws(() => loadConfig(directory), /Dependencies changed/);
  } finally {
    removeFixture(directory);
  }
});

function removeFixture(directory) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("vibepod-launcher-"));
  rmSync(directory, { recursive: true, force: true });
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test(
  "missing executable fails readiness promptly and cleanup accepts failed spawn",
  { timeout: 5000 },
  async () => {
    const child = startChild(
      "missing fixture",
      path.join(os.tmpdir(), "vibepod-nonexistent-executable"),
      []
    );
    await new Promise((resolve) => child.once("close", resolve));
    await assert.rejects(waitReady("http://127.0.0.1:1", child), /ENOENT/);
    stopChild(child);
  }
);

test(
  "stopping an owned Windows child also stops its descendant",
  { skip: process.platform !== "win32", timeout: 10000 },
  async () => {
    const port = await freePort();
    const fixture = path.resolve("scripts/tests/fixture.mjs");
    const code = `const {spawn}=require('node:child_process');spawn(process.execPath,[${JSON.stringify(fixture)},'${port}'],{stdio:'ignore'});setInterval(()=>{},1000)`;
    const child = startChild("parent fixture", process.execPath, ["-e", code]);
    try {
      await waitReady(`http://127.0.0.1:${port}`, child, 5000);
      const closed = once(child, "close");
      stopChild(child);
      await closed;
      await assertPortAvailable(port);
    } finally {
      stopChild(child);
    }
  }
);

const fixturePython =
  process.env.VIBEPOD_TEST_PYTHON ||
  (() => {
    try {
      return loadConfig().python;
    } catch {
      return null;
    }
  })();

for (const outcome of ["failure", "interrupt", "verbose"])
  test(
    `supervisor reaches readiness quietly and cleans up after ${outcome}`,
    { skip: !fixturePython, timeout: 15000 },
    async () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), "vibepod-launcher-"));
      let child;
      try {
        mkdirSync(path.join(directory, "server"));
        mkdirSync(path.join(directory, ".vibepod"));
        mkdirSync(path.join(directory, "web/node_modules/next/dist/bin"), { recursive: true });
        writeFileSync(path.join(directory, "server/uv.lock"), "fixture");
        writeFileSync(path.join(directory, "pnpm-lock.yaml"), "fixture");
        writeFileSync(path.join(directory, "server/doctor.py"), "print('fixture runtime ready')");
        writeFileSync(
          path.join(directory, "server/uvicorn.py"),
          `import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{}')
    def log_message(self, *args): pass
HTTPServer(('127.0.0.1', int(sys.argv[sys.argv.index('--port')+1])), Handler).serve_forever()
`
        );
        writeFileSync(
          path.join(directory, "web/node_modules/next/dist/bin/next"),
          `const http=require('node:http');const server=http.createServer((req,res)=>{console.log('GET '+req.url+' 200 in 1ms');res.end('{}');if(req.url==='/fail')setTimeout(()=>process.exit(7),20)});server.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1');`
        );
        const backendPort = await freePort();
        let webPort = await freePort();
        while (webPort === backendPort) webPort = await freePort();
        writeFileSync(
          path.join(directory, ".vibepod/config.json"),
          JSON.stringify({
            python: fixturePython,
            modelPath: directory,
            designModelPath: directory,
            hfHome: directory,
            backendPort,
            webPort,
            lockHash: lockHash(directory),
          })
        );
        const moduleUrl = new URL("../dev.mjs", import.meta.url).href;
        child = startChild("supervisor fixture", process.execPath, [
          "--input-type=module",
          "-e",
          `import {main} from ${JSON.stringify(moduleUrl)};await main({directory:${JSON.stringify(directory)},args:${JSON.stringify(outcome === "verbose" ? ["--verbose"] : [])}});${outcome === "interrupt" ? "setTimeout(()=>process.emit('SIGINT'),2500);" : ""}`,
        ]);
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        await waitReady(`http://127.0.0.1:${webPort}/api/health`, child, 10000);
        for (let attempt = 0; attempt < 30 && !output.includes("[studio] Ready:"); attempt++)
          await new Promise((resolve) => setTimeout(resolve, 100));
        assert.match(output, /\[studio\] Ready:/);
        if (outcome === "verbose") assert.match(output, /GET \/api\/health/);
        else assert.doesNotMatch(output, /GET \/api\/health/);
        const closed = once(child, "close");
        if (outcome !== "interrupt") await fetch(`http://127.0.0.1:${webPort}/fail`);
        const [exitCode] = await closed;
        assert.equal(exitCode, outcome === "interrupt" ? 0 : 1);
        await assertPortAvailable(backendPort);
        await assertPortAvailable(webPort);
        const nextLog = readFileSync(path.join(directory, ".vibepod/logs/next.log"), "utf8");
        assert.match(nextLog, /GET \/api\/health/);
      } finally {
        if (child) stopChild(child);
        removeFixture(directory);
      }
    }
  );
