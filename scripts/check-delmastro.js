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

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function extractLatestNewsWithBrowser() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(SITE_URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000);

    const latest = await page.evaluate(() => {
      function cleanText(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
      }

      function isBlockedHost(url) {
        try {
          const host = new URL(url).hostname.toLowerCase();
          return [
            "tongatron.github.io",
            "github.com",
            "www.github.com",
            "api.telegram.org",
            "t.me",
            "telegram.me"
          ].includes(host);
        } catch {
          return true;
        }
      }

      function isBadTitle(text) {
        const t = cleanText(text).toLowerCase();
        return (
          !t ||
          t === "apri la fonte" ||
          t === "apri notizia" ||
          t === "osservatorio caso delmastro" ||
          t === "rassegna" ||
          t === "fonti" ||
          t.length < 15
        );
      }

      function isLikelySource(text) {
        const t = cleanText(text);

        return (
          t &&
          t.length > 2 &&
          t.length < 50 &&
          /^[A-ZÀ-Ú0-9\s.'-]+$/.test(t)
        );
      }

      function extractCardData(linkEl) {
        let prev = linkEl.previousElementSibling;
        const titleCandidates = [];
        const sourceCandidates = [];

        while (prev) {
          const text = cleanText(prev.innerText || prev.textContent);

          if (!isBadTitle(text)) {
            titleCandidates.push(text);
          }

          if (isLikelySource(text)) {
            sourceCandidates.push(text);
          }

          const inner = Array.from(
            prev.querySelectorAll("h1,h2,h3,h4,p,div,span,strong,b")
          )
            .map(el => cleanText(el.innerText || el.textContent))
            .filter(Boolean);

          inner.forEach(t => {
            if (!isBadTitle(t)) {
              titleCandidates.push(t);
            }

            if (isLikelySource(t)) {
              sourceCandidates.push(t);
            }
          });

          prev = prev.previousElementSibling;
        }

        let title = "Nuova notizia";
        let source = "";

        if (titleCandidates.length) {
          titleCandidates.sort((a, b) => b.length - a.length);
          title = titleCandidates[0];
        }

        if (sourceCandidates.length) {
          source = sourceCandidates[0];
        }

        return { title, source };
      }

      const sourceAnchors = Array.from(document.querySelectorAll("a[href]"))
        .filter(a => /apri la fonte/i.test(cleanText(a.textContent)))
        .map(a => ({
          el: a,
          url: a.href
        }))
        .filter(x => x.url && /^https?:\/\//i.test(x.url))
        .filter(x => !isBlockedHost(x.url));

      if (!sourceAnchors.length) {
        throw new Error("Nessun link 'Apri la fonte' trovato.");
      }

      const first = sourceAnchors[0];
      const cardData = extractCardData(first.el);

      return {
        source: cardData.source,
        title: cardData.title,
        url: first.url
      };
    });

    if (!latest || !latest.url) {
      throw new Error("Impossibile estrarre la notizia.");
    }

    return latest;
  } finally {
    await browser.close();
  }
}

async function sendTelegram(source, title, url) {
  const safeSource = escapeHtml(source || "");
  const safeTitle = escapeHtml(title);
  const safeUrl = escapeHtml(url);

  const text =
    `🆕 <b>Nuova notizia nella rassegna</b>\n\n` +
    (safeSource ? `<i>${safeSource}</i>\n\n` : "") +
    `<b>${safeTitle}</b>\n\n` +
    `<a href="${safeUrl}">Apri notizia</a>`;

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
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

  await sendTelegram(latest.source, latest.title, latest.url);
  saveState({ url: latest.url });
  console.log("Nuova notizia inviata:", latest.url);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
