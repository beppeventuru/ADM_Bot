const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const SITE_URL = "https://tongatron.github.io/osservatorio-delmastro/";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const STATE_FILE = path.join(process.cwd(), "state", "last-news.json");

if (!BOT_TOKEN || !CHAT_ID) {
  throw new Error("Mancano TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID nei Secrets.");
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
    const host = u.hostname.toLowerCase();

    if (!["http:", "https:"].includes(u.protocol)) return false;

    const blockedHosts = [
      "tongatron.github.io",
      "github.com",
      "www.github.com",
      "api.telegram.org",
      "t.me",
      "telegram.me"
    ];

    return !blockedHosts.includes(host);
  } catch {
    return false;
  }
}

async function extractLatestNewsWithBrowser() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000);

    const links = await page.$$eval("a[href]", anchors =>
      anchors.map(a => ({
        title: (a.textContent || "").replace(/\s+/g, " ").trim(),
        url: a.href
      }))
    );

    const validLinks = links.filter(x => x.url && /^https?:\/\//i.test(x.url));

    const newsLinks = validLinks.filter(x => {
      try {
        const u = new URL(x.url);
        const host = u.hostname.toLowerCase();
        return ![
          "tongatron.github.io",
          "github.com",
          "www.github.com",
          "api.telegram.org",
          "t.me",
          "telegram.me"
        ].includes(host);
      } catch {
        return false;
      }
    });

    if (!newsLinks.length) {
      throw new Error("Nessun link notizia trovato dopo il rendering della pagina.");
    }

    return {
      title: newsLinks[0].title || "Nuovo articolo",
      url: newsLinks[0].url
    };
  } finally {
    await browser.close();
  }
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
      text,
      disable_web_page_preview: false
    })
  });

  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Errore Telegram: ${JSON.stringify(data)}`);
  }
}

async function main() {
  const latest = await extractLatestNewsWithBrowser();
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
