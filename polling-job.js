const axios = require("axios");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const API_KEY = process.env.API_KEY;
const WEBHOOK_URL = process.env.HEALTH_SYNC_WEBHOOK_URL || "http://localhost:3000/webhooks/health-sync";

if (!MONGO_URI) {
    console.error("Missing MONGO_URI environment variable");
    process.exit(1);
}

if (!API_KEY) {
    console.error("Missing API_KEY environment variable");
    process.exit(1);
}

const ServerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    url: { type: String, required: true },
    status: { type: String, default: "Unknown" },
}, { collection: "servers" });

const Server = mongoose.model("PollingServer", ServerSchema);

function buildDownReason(error) {
    if (error.response) {
        return `HTTP ${error.response.status} ${error.response.statusText || ""}`.trim();
    }
    if (error.code) {
        return error.code;
    }
    if (error.message) {
        return error.message;
    }
    return "Connection failed";
}

async function runPollingJob() {
    const timestamp = new Date();
    const statuses = {};

    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
    });

    try {
        const servers = await Server.find({}).lean();

        for (const server of servers) {
            try {
                await axios.get(server.url, { timeout: 3000 });
                statuses[server.name] = { status: "Up", reason: "OK 200" };
            } catch (error) {
                statuses[server.name] = {
                    status: "Down",
                    reason: buildDownReason(error),
                };
            }
        }

        const payload = { timestamp, statuses };

        await axios.post(WEBHOOK_URL, payload, {
            headers: {
                "Content-Type": "application/json",
                "x-api-key": API_KEY,
            },
            timeout: 10000,
        });

        console.log(`Health sync sent for ${Object.keys(statuses).length} servers at ${timestamp.toISOString()}`);
    } finally {
        await mongoose.disconnect();
    }
}

runPollingJob()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Polling job failed:", error.message);
        process.exit(1);
    });
