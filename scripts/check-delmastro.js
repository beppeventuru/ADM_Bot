const fs = require("fs");
const path = require("path");

const SITE_URL = "https://tongatron.github.io/osservatorio-delmastro/";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const STATE_FILE = path.join(process.cwd(), "state", "last-news.json");

if (!BOT_TOKEN || !CHAT_ID) {
  throw new Error("Mancano TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID nei Secrets.");
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DelmastroBot/1.0)"
    }
  });

  if (!res.ok) {
    throw new Error(`Errore nel caricamento del sito: ${res.status}`);
  }

  return await res.text();
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { url: "" };
  }
}

function saveState(data) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function isValidNewsUrl(url) {
  try {
    const u = new URL(url);

    if (!["http:", "https:"].includes(u.protocol)) return false;

    const host = u.hostname.toLowerCase();

    const blockedHosts = [
      "tongatron.github.io",
      "github.com",
      "www.github.com",
      "api.telegram.org",
      "t.me",
      "telegram.me"
    ];

    if (blockedHosts.includes(host)) return false;

    return true;
  } catch {
    return false;
  }
}

function extractLatestNews(html) {
  const matches = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gis)];

  const links = matches
    .map(m => {
      const href = m[1].trim();
      const title = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      return { href, title };
    })
    .filter(x => isValidNewsUrl(x.href));

  if (!links.length) {
    throw new Error("Nessun link notizia trovato.");
  }

  return {
    title: links[0].title || "Nuovo articolo",
    url: links[0].href
  };
}

async function sendTelegram(title, url) {
  const text = `🆕 Nuovo articolo nella rassegna\n\n${title}\n\n${url}`;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      disable_web_page_preview: false
    })
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Errore Telegram: ${JSON.stringify(data)}`);
  }
}

async function main() {
  const html = await fetchPage(SITE_URL);
  const latest = extractLatestNews(html);
  const state = loadState();

  if (state.url === latest.url) {
    console.log("Nessuna nuova notizia.");
    return;
  }

  await sendTelegram(latest.title, latest.url);
  saveState({ url: latest.url });
  console.log("Nuova notizia inviata:", latest.url);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
