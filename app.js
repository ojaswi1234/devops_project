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
    provider: { type: String, default: "manual" }, // manual, render
    project: { type: String }, // Project/service name
    environment: { type: String }, // production, staging, etc.
    externalId: { type: String }, // External deployment ID from provider
    url: { type: String }, // External deployment URL
    commitId: { type: String }, // Git commit ID
    commitMessage: { type: String }, // Git commit message
    rawPayload: { type: Object }, // Full webhook payload for debugging
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

// Render webhook endpoint (no authentication for external webhooks)
app.post("/webhooks/render", async (req, res) => {
    try {
        const payload = req.body;
        console.log("Render webhook received:", JSON.stringify(payload, null, 2));

        // Extract deployment data from Render webhook
        const deployment = new Deployment({
            version: payload.commit?.id?.substring(0, 7) || "unknown",
            status: payload.status || "unknown", // live, building, failed, etc.
            timestamp: payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            provider: "render",
            project: payload.service?.name || "unknown",
            environment: payload.service?.environment || "production",
            externalId: payload.id,
            url: payload.service?.url,
            commitId: payload.commit?.id,
            commitMessage: payload.commit?.message,
            rawPayload: payload,
        });

        await deployment.save();
        console.log("Render deployment saved:", deployment);
        res.status(200).json({ message: "Webhook received" });
    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).json({ message: "Webhook processing failed", error: error.message });
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

// Fetch deployments directly from Render API
// ...existing code...

// Render API integration - fetch live deployment data
app.get("/render-deployments", authenticate, async (req, res) => {
    try {
        const apiKey = process.env.RENDER_API_KEY;
        
        if (!apiKey) {
            console.error("RENDER_API_KEY not set in .env file");
            return res.status(500).json({ error: "Render API key not configured" });
        }

        console.log("Making request to Render API with key:", apiKey.substring(0, 10) + "...");
        
        const response = await axios.get("https://api.render.com/v1/services", {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Accept": "application/json"
            },
            timeout: 10000
        });

        console.log("Render API Response Status:", response.status);
        console.log("Response structure:", JSON.stringify(response.data).substring(0, 500));

        // Render API returns array of service objects wrapped in {service: {...}}
        const services = Array.isArray(response.data) ? response.data : [];
        console.log(`Found ${services.length} services`);
        
        const deployments = [];

        for (const serviceWrapper of services) {
            try {
                // Extract the actual service object
                const service = serviceWrapper.service || serviceWrapper;
                
                if (!service || !service.id) {
                    console.log("Skipping invalid service:", serviceWrapper);
                    continue;
                }

                const serviceId = service.id;
                const serviceName = service.name;
                console.log(`Fetching deploys for: ${serviceName} (${serviceId})`);

                const deployResponse = await axios.get(
                    `https://api.render.com/v1/services/${serviceId}/deploys`,
                    {
                        headers: {
                            "Authorization": `Bearer ${apiKey}`,
                            "Accept": "application/json"
                        },
                        params: { limit: 5 }
                    }
                );

                // Parse deploy response (also might be wrapped)
                let deploys = [];
                if (Array.isArray(deployResponse.data)) {
                    deploys = deployResponse.data;
                } else if (deployResponse.data && Array.isArray(deployResponse.data.deploys)) {
                    deploys = deployResponse.data.deploys;
                }

                deploys.forEach(deployWrapper => {
                    const deploy = deployWrapper.deploy || deployWrapper;
                    deployments.push({
                        serviceName: serviceName,
                        serviceType: service.type,
                        status: deploy.status || 'unknown',
                        commitId: deploy.commit?.id,
                        commitMessage: deploy.commit?.message,
                        serviceUrl: service.serviceDetails?.url,
                        createdAt: deploy.createdAt || new Date().toISOString(),
                        environment: service.env || 'production'
                    });
                });
            } catch (deployError) {
                const service = serviceWrapper.service || serviceWrapper;
                console.error(`Error fetching deploys for service ${service?.id || 'unknown'}:`, {
                    message: deployError.message,
                    status: deployError.response?.status
                });
            }
        }

        res.json(deployments);
    } catch (error) {
        console.error("Render API error details:", {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        
        if (error.response?.status === 401) {
            res.status(401).json({ 
                error: "Unauthorized - Check your Render API key",
                hint: "Get your API key from https://dashboard.render.com/u/settings#api-keys"
            });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// ...existing code...

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