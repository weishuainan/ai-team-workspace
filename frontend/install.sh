#!/bin/bash
set -e

source ~/.bashrc
exec node -e '
const fs = require("fs");
const http = require("http");
const path = require("path");
const root = path.join(process.cwd(), "dist");
const contentTypes = { ".css": "text/css", ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

http.createServer((request, response) => {
  const requestPath = decodeURIComponent(request.url.split("?")[0]);
  const filePath = path.join(root, requestPath === "/" ? "index.html" : requestPath);
  const resolvedPath = path.resolve(filePath);
  const safePath = resolvedPath.startsWith(`${root}${path.sep}`) ? resolvedPath : path.join(root, "index.html");
  const targetPath = fs.existsSync(safePath) && fs.statSync(safePath).isFile() ? safePath : path.join(root, "index.html");

  response.writeHead(200, { "Content-Type": contentTypes[path.extname(targetPath)] || "application/octet-stream" });
  fs.createReadStream(targetPath).pipe(response);
}).listen(8080, "0.0.0.0");
'
