const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("Connected to MongoDB"))
    .catch(err => console.error("MongoDB connection error:", err));

// MongoDB Schemas
const ServerSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    url: { type: String, required: true },
    status: { type: String, default: "Unknown" },
});

const LogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    statuses: { type: Object, required: true },
});

const DeploymentSchema = new mongoose.Schema({
    version: { type: String, required: true },
    status: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
});

const Server = mongoose.model("Server", ServerSchema);
const Log = mongoose.model("Log", LogSchema);
const Deployment = mongoose.model("Deployment", DeploymentSchema);

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

let PIPELINE_STATUS = "success";

const SERVER_HEALTH_LOGS = [];

// Authentication Middleware
const authenticate = (req, res, next) => {
    const apiKey = req.headers["x-api-key"];
    if (apiKey === process.env.API_KEY) {
        next();
    } else {
        res.status(403).json({ message: "Forbidden: Invalid API Key" });
    }
};

// Update checkServerHealth to ensure server health is fetched and stored correctly
const checkServerHealth = async () => {
    let statuses = {};
    try {
        const servers = await Server.find(); // Fetch servers from MongoDB
        for (let server of servers) {
            try {
                const response = await axios.get(server.url, { timeout: 3000 });
                statuses[server.name] = { status: "Up", reason: "OK 200" };
            } catch (error) {
                let reason = 'Connection failed';
                if (error.response) {
                    reason = `HTTP ${error.response.status} ${error.response.statusText || ''}`;
                } else if (error.code) {
                    reason = error.code; // e.g., ECONNREFUSED, ETIMEDOUT
                } else if (error.message) {
                    reason = error.message;
                }
                statuses[server.name] = {
                    status: "Down",
                    reason: reason,
                };
            }
            server.status = statuses[server.name].status;
            await server.save(); // Update server status in MongoDB
        }
        const log = new Log({ timestamp: new Date(), statuses });
        await log.save(); // Save the health check log
    } catch (error) {
        console.error("Error checking server health:", error.message);
    }
    return statuses;
};

app.set('view engine', 'ejs');
app.set('views', './views');

app.get("/", (req, res) => {
    res.render('index');
});

app.get("/status", async (req, res) => {
    try {
        const serverHealth = await checkServerHealth();
        res.json({ "CI/CD Status": PIPELINE_STATUS, "Server Health": serverHealth });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});

// Update /deploy to track version control
app.post("/deploy", authenticate, async (req, res) => {
    const { version } = req.body;
    if (!version) {
        return res.status(400).json({ message: "Version is required" });
    }
    PIPELINE_STATUS = "in_progress";
    const deployment = new Deployment({ version, status: "in_progress", timestamp: new Date() });
    await deployment.save();

    // Simulate deployment logic
    setTimeout(async () => {
        PIPELINE_STATUS = "success";
        deployment.status = "success";
        await deployment.save();
    }, 2000);

    res.json({ message: "Deployment triggered", status: PIPELINE_STATUS, version });
});

// Update /servers to use MongoDB
app.post("/servers", authenticate, async (req, res) => {
    const { name, url } = req.body;
    if (!name || !url) {
        return res.status(400).json({ message: "Name and URL are required" });
    }
    try {
        const server = new Server({ name, url });
        await server.save();
        res.status(201).json({ message: "Server added", server });
    } catch (error) {
        if (error.code === 11000) {
            res.status(409).json({ message: "Server with this name already exists" });
        } else {
            res.status(500).json({ message: "Internal Server Error", error: error.message });
        }
    }
});

app.delete("/servers/:name", authenticate, async (req, res) => {
    const { name } = req.params;
    try {
        const server = await Server.findOneAndDelete({ name });
        if (server) {
            res.json({ message: "Server removed", server });
        } else {
            res.status(404).json({ message: "Server not found" });
        }
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});

// Update /logs to fetch from MongoDB
app.post('/logs_delete', authenticate, async (req, res) => {
  try {
    await Log.deleteMany({});
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Delete logs error:', err);
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Add endpoint to view deployment history
app.get("/deployments", authenticate, async (req, res) => {
    try {
        const deployments = await Deployment.find();
        res.json(deployments);
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});

// Update /dashboard endpoint to ensure server health is displayed correctly
app.get("/dashboard", async (req, res) => {
    const { url } = req.query; // Accept URL as input via query parameter
    let urlStatus = "Unknown";

    if (url) {
        try {
            const response = await axios.get(url, { timeout: 3000 });
            urlStatus = response.status === 200 ? "Up" : "Down";
        } catch (error) {
            urlStatus = "Down";
        }
    }

    try {
        const serverHealth = await checkServerHealth(); // Fetch server health
        const logs = await Log.find().sort({ timestamp: -1 }); // Sort by timestamp descending (latest first)
        const deployments = await Deployment.find().sort({ timestamp: -1 }); // Sort by timestamp descending (latest first)

        res.render('dashboard', {
            url: url || "N/A",
            urlStatus,
            pipelineStatus: PIPELINE_STATUS,
            serverHealth,
            logs,
            deployments,
        });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});

setInterval(async () => {
  try {
    await checkServerHealth();
    console.log("Auto health check completed.");
  } catch (err) {
    console.error("Auto health check failed:", err);
  }
}, 60 * 1000);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`https://localhost:${PORT}`);
});