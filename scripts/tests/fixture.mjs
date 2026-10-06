import http from "node:http";
const server = http.createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end('{"status":"online"}');
});
server.listen(Number(process.argv[2]), "127.0.0.1", () => process.stdout.write("ready\n"));
process.on("SIGTERM", () => server.close());
