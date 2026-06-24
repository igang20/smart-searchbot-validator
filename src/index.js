const http = require("http");
const httpProxy = require("http-proxy");
const dns = require("dns").promises;
const fs = require("fs");
const path = require("path");

const PORT = 3001;
const REACT_URL = "http://127.0.0.1:2000";
const RENDERTRON_URL = "http://127.0.0.1:3000";

// Читаем обновленный конфиг
const configPath = path.join(__dirname, "bots-config.json");
const botsConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

const proxy = httpProxy.createProxyServer({});
const verifiedBotsCache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 24; // Кэш на 24 часа

// Поиск совпадений среди поисковиков или AI-ботов
function findEngineOrCrawler(ua) {
  // Ищем в поисковиках
  let match = botsConfig.searchEngines.find((b) =>
    b.tokens.some((t) => ua.includes(t)),
  );
  if (match) return match;

  // Ищем в AI-краулерах
  return botsConfig.aiCrawlers.find((b) =>
    b.tokens.some((t) => ua.includes(t)),
  );
}

// Проверка соцсетей
function isSocialOrPreview(ua) {
  return botsConfig.socialAndPreviewBots.some((token) => ua.includes(token));
}

// Главная логика валидации
async function verifyBot(ip, ua) {
  const userAgent = ua.toLowerCase();

  // 1. Соцсети пускаем сразу (превью ссылок)
  if (isSocialOrPreview(userAgent)) return true;

  // 2. Проверяем, относится ли бот к поисковикам или AI
  const botTarget = findEngineOrCrawler(userAgent);
  if (!botTarget) return false; // Обычный юзер или левый сканер

  // 3. Проверка кэша IP
  if (verifiedBotsCache.has(ip)) {
    const cached = verifiedBotsCache.get(ip);
    if (Date.now() < cached.expire) return cached.isBot;
  }

  try {
    // Двойной DNS-чекинг (Reverse + Forward)
    const hostnames = await dns.reverse(ip);
    if (!hostnames || hostnames.length === 0) throw new Error("No PTR records");
    const hostname = hostnames[0].toLowerCase();

    // Проверяем суффикс по белому списку из JSON
    const isValidDomain = botTarget.dnsSuffixes.some((suffix) =>
      hostname.endsWith(suffix),
    );
    if (!isValidDomain) {
      verifiedBotsCache.set(ip, {
        isBot: false,
        expire: Date.now() + CACHE_TTL,
      });
      return false;
    }

    const resolvedIps = await dns.resolve(hostname);
    const isBotReal = resolvedIps.includes(ip);

    verifiedBotsCache.set(ip, {
      isBot: isBotReal,
      expire: Date.now() + CACHE_TTL,
    });
    return isBotReal;
  } catch (err) {
    // В случае сбоя DNS блокируем, но всего на 5 минут (вдруг временный лаг сети)
    verifiedBotsCache.set(ip, {
      isBot: false,
      expire: Date.now() + 1000 * 60 * 5,
    });
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const clientIp = req.headers["x-real-ip"] || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  const isRealBot = await verifyBot(clientIp, userAgent);

  if (isRealBot) {
    console.log(
      `[${new Date().toISOString()}] Доверенный бот: ${clientIp} | UA: ${userAgent.substring(0, 40)}... -> Rendertron`,
    );

    const cleanUrl = req.url.startsWith("http")
      ? req.url
      : `https://${req.headers.host}${req.url}`;
    const parsedUrl = new URL(cleanUrl);
    const rendertronTarget = `${RENDERTRON_URL}/render/${parsedUrl.href}`;
    proxy.web(req, res, {
      target: rendertronTarget,
    });
  } else {
    // Логируем попытку фейк-запроса, если UA совпал, а DNS — нет
    if (findEngineOrCrawler(userAgent.toLowerCase())) {
      console.warn(
        `[${new Date().toISOString()}] ЗАБЛОКИРОВАН ФЕЙК: ${clientIp} | UA: ${userAgent.substring(0, 40)}...`,
      );
    }
    proxy.web(req, res, { target: REACT_URL });
  }
});

proxy.on("error", (err, req, res) => {
  res.writeHead(500, { "Content-Type": "text/plain" });
  res.end("Proxy Error");
});

server.listen(PORT, () => {
  console.log(
    `Умный JSON-валидатор (Поисковики + AI + Соцсети) запущен на порту ${PORT}`,
  );
});
