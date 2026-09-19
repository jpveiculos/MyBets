import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDatabase, pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = Number(process.env.PORT || 10000);
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      service: "mybets-roulette",
      database: "connected",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Health check do banco falhou:", error);
    res.status(503).json({
      ok: false,
      service: "mybets-roulette",
      database: "disconnected"
    });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    ok: true,
    environment: isProduction ? "production" : "development"
  });
});

const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

app.get("/", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error("Erro não tratado:", err);
  res.status(500).json({ message: "Erro interno do servidor." });
});

let server;

async function start() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não configurada.");
  }

  await initDatabase();

  server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`MyBets Roulette rodando na porta ${PORT}.`);
  });
}

async function shutdown(signal) {
  console.log(`Recebido ${signal}. Encerrando servidor...`);
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start().catch(error => {
  console.error("Falha ao iniciar MyBets Roulette:", error);
  process.exit(1);
});
