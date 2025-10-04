// src/index.js
import "dotenv/config";
import fs from "node:fs";
import https from "node:https";
import express from "express";
import { applySecurity } from "./security.js";
import { buildRoutes } from "./routes.js";

const {
  PORT = "8443",
  TLS_CERT_PATH = "./certs/server.crt",
  TLS_KEY_PATH = "./certs/server.key",
} = process.env;

async function main() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  applySecurity(app);
  app.use("/", buildRoutes());

  const options = {
    cert: fs.readFileSync(TLS_CERT_PATH),
    key: fs.readFileSync(TLS_KEY_PATH),
  };

  https.createServer(options, app).listen(Number(PORT), () => {
    // eslint-disable-next-line no-console
    console.log(`🔐 API listening on https://localhost:${PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err);
  process.exit(1);
});
