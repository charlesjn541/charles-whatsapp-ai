// ================================
// CHARLES — WHATSAPP AI AGENT
// Business + Admin Mode (ONE FILE)
// ================================

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
app.use(express.json());

// ================================
// ENV VARIABLES
// ================================
const {
  OPENAI_KEY,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  ADMIN_PASSWORD,
  GOOGLE_SHEET_WEBHOOK,
  OFFICE_START = 9,
  OFFICE_END = 17,
} = process.env;

const VERIFY_TOKEN = "charles_verify";

// ================================
// SIMPLE STORAGE (JSON)
// ================================
const DB_FILE = "users.json";
let users = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE))
  : {};

const saveDB = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));

// ================================
// SYSTEM PROMPTS
// ================================
const BUSINESS_PROMPT = `
You are Charles, a professional WhatsApp business assistant.
Be polite, concise, and accurate.
Never make legal or financial promises.
If unsure, escalate to a human agent.
`;

const ADMIN_PROMPT = `
You are Charles in ADMIN MODE.
Be direct, technical, and helpful.
No greetings. No marketing tone.
`;

// ================================
// HELPERS
// ================================
const delay = ms => new Promise(r => setTimeout(r, ms));

const isOfficeHours = () => {
  const hour = new Date().getHours();
  return hour >= OFFICE_START && hour < OFFICE_END;
};

// ================================
// SEND WHATSAPP MESSAGE
// ================================
async function sendMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ================================
// OPENAI REQUEST
// ================================
async function askAI(systemPrompt, messages) {
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.data.choices[0].message.content;
}

// ================================
// GOOGLE SHEETS CRM SYNC
// ================================
async function syncToSheets(user) {
  if (!GOOGLE_SHEET_WEBHOOK) return;
  try {
    await axios.post(GOOGLE_SHEET_WEBHOOK, user);
  } catch (e) {
    console.error("Sheets sync failed");
  }
}

// ================================
// WEBHOOK VERIFICATION
// ================================
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// ================================
// MAIN WEBHOOK
// ================================
app.post("/webhook", async (req, res) => {
  const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!msg) return res.sendStatus(200);

  const from = msg.from;
  const text = msg.text?.body?.trim();
  if (!text) return res.sendStatus(200);

  // Human-like delay
  await delay(10000);

  // Init user
  if (!users[from]) {
    users[from] = {
      name: null,
      email: null,
      greeted: false,
      admin: false,
      memory: [],
    };
    saveDB();
  }

  const user = users[from];

  // ================================
  // ADMIN LOGIN
  // ================================
  if (text === `/admin ${ADMIN_PASSWORD}`) {
    user.admin = true;
    saveDB();
    await sendMessage(from, "✅ Admin mode activated.");
    return res.sendStatus(200);
  }

  // ================================
  // ADMIN COMMANDS
  // ================================
  if (user.admin) {
    if (text === "/stats") {
      await sendMessage(from, `📊 Total users: ${Object.keys(users).length}`);
      return res.sendStatus(200);
    }

    if (text === "/users") {
      await sendMessage(from, Object.keys(users).join("\n"));
      return res.sendStatus(200);
    }

    if (text.startsWith("/reset")) {
      const phone = text.split(" ")[1];
      delete users[phone];
      saveDB();
      await sendMessage(from, "♻️ User reset complete.");
      return res.sendStatus(200);
    }

    const adminReply = await askAI(ADMIN_PROMPT, [
      { role: "user", content: text },
    ]);
    await sendMessage(from, adminReply);
    return res.sendStatus(200);
  }

  // ================================
  // OFFICE HOURS
  // ================================
  if (!isOfficeHours()) {
    await sendMessage(
      from,
      "⏰ Thanks for messaging us! Our team will respond during office hours."
    );
    return res.sendStatus(200);
  }

  // ================================
  // ONBOARDING FLOW
  // ================================
  if (!user.greeted) {
    user.greeted = true;
    saveDB();
    await sendMessage(from, "Hello 👋 I'm Charles. What's your name?");
    return res.sendStatus(200);
  }

  if (!user.name) {
    user.name = text;
    saveDB();
    await sendMessage(from, "Nice to meet you! Please share your email address.");
    return res.sendStatus(200);
  }

  if (!user.email) {
    user.email = text;
    saveDB();
    await syncToSheets({ phone: from, ...user });
    await sendMessage(from, "✅ You're all set! How can I help you today?");
    return res.sendStatus(200);
  }

  // ================================
  // MEMORY + AI RESPONSE
  // ================================
  user.memory.push({ role: "user", content: text });
  user.memory = user.memory.slice(-10);

  const reply = await askAI(BUSINESS_PROMPT, user.memory);

  user.memory.push({ role: "assistant", content: reply });
  saveDB();

  await sendMessage(from, reply);
  res.sendStatus(200);
});

// ================================
app.listen(3000, () => {
  console.log("🚀 Charles WhatsApp AI running on port 3000");
});
