const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const session = require("express-session");
const multer = require("multer");
const path = require("path");

const app = express();

// Configure multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('stylesheets'));

// Session configuration
app.use(session({
    secret: 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 30 * 60 * 1000, // 30 minutes
        httpOnly: true,
        secure: false // Set to true if using HTTPS
    }
}));

// Guest mode default configuration
const GUEST_CONFIG = {
    MONGO_URI: "mongodb://localhost:27017/devops_guest",
    API_KEY: "guest-api-key-12345",
    RENDER_API_KEY: "",
    PORT: 3000
};

// Sample guest data (pre-populated)
const GUEST_SERVERS = [
    { name: "Demo Server 1", url: "https://httpstat.us/200", status: "Up" },
    { name: "Demo Server 2", url: "https://httpstat.us/500", status: "Down" }
];

const GUEST_LOGS = [
    {
        timestamp: new Date(Date.now() - 60000),
        statuses: {
            "Demo Server 1": { status: "Up", reason: "OK 200" },
            "Demo Server 2": { status: "Down", reason: "HTTP 500" }
        }
    }
];

const GUEST_DEPLOYMENTS = [
    {
        version: "v1.0.0",
        status: "success",
        timestamp: new Date(Date.now() - 120000),
        provider: "manual",
        project: "Demo Project",
        environment: "production"
    }
];

// Parse .env content into key-value pairs
function parseEnvContent(content) {
    const config = {};
    const lines = content.toString().split('\n');
    
    for (let line of lines) {
        line = line.trim();
        
        // Skip empty lines and comments
        if (!line || line.startsWith('#')) continue;
        
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) continue;
        
        const key = line.substring(0, separatorIndex).trim();
        let value = line.substring(separatorIndex + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        
        config[key] = value;
    }
    
    return config;
}

// MongoDB Connection Manager
let mongoConnection = null;

async function connectToMongoDB(uri) {
    try {
        if (mongoConnection) {
            await mongoConnection.close();
        }
        mongoConnection = await mongoose.connect(uri, { 
            useNewUrlParser: true, 
            useUnifiedTopology: true 
        });
        console.log("Connected to MongoDB:", uri);
        return true;
    } catch (err) {
        console.error("MongoDB connection error:", err);
        return false;
    }
}

// Initialize MongoDB schemas
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
    provider: { type: String, default: "manual" },
    project: { type: String },
    environment: { type: String },
    externalId: { type: String },
    url: { type: String },
    commitId: { type: String },
    commitMessage: { type: String },
    rawPayload: { type: Object },
});

const Server = mongoose.model("Server", ServerSchema);
const Log = mongoose.model("Log", LogSchema);
const Deployment = mongoose.model("Deployment", DeploymentSchema);

// Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
});
app.use(limiter);

let PIPELINE_STATUS = "success";

// Middleware to check if user has uploaded credentials
const requireAuth = (req, res, next) => {
    if (req.session.isGuest === false && req.session.config) {
        next();
    } else if (req.session.isGuest === true) {
        next();
    } else {
        res.redirect('/?error=upload_required');
    }
};

// Authentication Middleware for API calls
const authenticate = (req, res, next) => {
    const apiKey = req.headers["x-api-key"];
    const sessionApiKey = req.session.config ? req.session.config.API_KEY : GUEST_CONFIG.API_KEY;
    
    if (apiKey === sessionApiKey) {
        next();
    } else {
        res.status(403).json({ message: "Forbidden: Invalid API Key" });
    }
};

// Health check function
const checkServerHealth = async (isGuest = false) => {
    let statuses = {};
    try {
        if (isGuest) {
            // Return mock data for guest mode
            for (let server of GUEST_SERVERS) {
                statuses[server.name] = { status: server.status, reason: server.status === "Up" ? "OK 200" : "Connection failed" };
            }
            return statuses;
        }
        
        const servers = await Server.find();
        for (let server of servers) {
            try {
                const response = await axios.get(server.url, { timeout: 3000 });
                statuses[server.name] = { status: "Up", reason: "OK 200" };
            } catch (error) {
                let reason = 'Connection failed';
                if (error.response) {
                    reason = `HTTP ${error.response.status} ${error.response.statusText || ''}`;
                } else if (error.code) {
                    reason = error.code;
                } else if (error.message) {
                    reason = error.message;
                }
                statuses[server.name] = {
                    status: "Down",
                    reason: reason,
                };
            }
            server.status = statuses[server.name].status;
            await server.save();
        }
        const log = new Log({ timestamp: new Date(), statuses });
        await log.save();
    } catch (error) {
        console.error("Error checking server health:", error.message);
    }
    return statuses;
};

app.set('view engine', 'ejs');
app.set('views', './views');

// Home route - file upload page
app.get("/", (req, res) => {
    const error = req.query.error;
    res.render('index', { error });
});

// Handle .env file upload
app.post("/upload-env", upload.single('envFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.redirect('/?error=no_file');
        }
        
        // Parse the uploaded .env file content
        const envContent = req.file.buffer.toString('utf-8');
        const config = parseEnvContent(envContent);
        
        // Validate required fields
        if (!config.MONGO_URI || !config.API_KEY) {
            return res.redirect('/?error=invalid_env');
        }
        
        // Store configuration in session
        req.session.config = {
            MONGO_URI: config.MONGO_URI,
            API_KEY: config.API_KEY,
            RENDER_API_KEY: config.RENDER_API_KEY || "",
            PORT: config.PORT || 3000
        };
        req.session.isGuest = false;
        
        // Connect to MongoDB with user's credentials
        const connected = await connectToMongoDB(config.MONGO_URI);
        
        if (!connected) {
            return res.redirect('/?error=db_connection_failed');
        }
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error("Upload error:", error);
        res.redirect('/?error=upload_failed');
    }
});

// Guest mode route
app.post("/guest-mode", async (req, res) => {
    try {
        req.session.config = GUEST_CONFIG;
        req.session.isGuest = true;
        
        // Connect to guest MongoDB
        await connectToMongoDB(GUEST_CONFIG.MONGO_URI);
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error("Guest mode error:", error);
        res.redirect('/?error=guest_mode_failed');
    }
});

// Logout route - clear session
app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Session destroy error:", err);
        }
        res.redirect('/');
    });
});

// Status endpoint
app.get("/status", requireAuth, async (req, res) => {
    try {
        const serverHealth = await checkServerHealth(req.session.isGuest);
        res.json({ 
            "CI/CD Status": PIPELINE_STATUS, 
            "Server Health": serverHealth,
            "Mode": req.session.isGuest ? "Guest" : "Authenticated"
        });
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});

// Deploy endpoint
app.post("/deploy", requireAuth, authenticate, async (req, res) => {
    const { version } = req.body;
    if (!version) {
        return res.status(400).json({ message: "Version is required" });
    }
    
    if (req.session.isGuest) {
        return res.status(403).json({ message: "Cannot deploy in guest mode" });
    }
    
    PIPELINE_STATUS = "in_progress";
    const deployment = new Deployment({ version, status: "in_progress", timestamp: new Date() });
    await deployment.save();

    setTimeout(async () => {
        PIPELINE_STATUS = "success";
        deployment.status = "success";
        await deployment.save();
    }, 2000);

    res.json({ message: "Deployment triggered", status: PIPELINE_STATUS, version });
});

// Add server endpoint
app.post("/servers", requireAuth, authenticate, async (req, res) => {
    if (req.session.isGuest) {
        return res.status(403).json({ message: "Cannot add servers in guest mode" });
    }
    
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

// Delete server endpoint
app.delete("/servers/:name", requireAuth, authenticate, async (req, res) => {
    if (req.session.isGuest) {
        return res.status(403).json({ message: "Cannot delete servers in guest mode" });
    }
    
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

// Delete logs endpoint
app.post('/logs_delete', requireAuth, authenticate, async (req, res) => {
    if (req.session.isGuest) {
        return res.status(403).json({ message: "Cannot delete logs in guest mode" });
    }
    
    try {
        await Log.deleteMany({});
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Delete logs error:', err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Render webhook endpoint
app.post("/webhooks/render", async (req, res) => {
    try {
        const payload = req.body;
        console.log("Render webhook received:", JSON.stringify(payload, null, 2));

        const deployment = new Deployment({
            version: payload.commit?.id?.substring(0, 7) || "unknown",
            status: payload.status || "unknown",
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

// View deployment history
app.get("/deployments", requireAuth, authenticate, async (req, res) => {
    try {
        if (req.session.isGuest) {
            return res.json(GUEST_DEPLOYMENTS);
        }
        const deployments = await Deployment.find();
        res.json(deployments);
    } catch (error) {
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});

// Render API integration
app.get("/render-deployments", requireAuth, async (req, res) => {
    try {
        if (req.session.isGuest) {
            return res.json([]);
        }
        
        const apiKey = req.session.config.RENDER_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ error: "Render API key not configured" });
        }

        const response = await axios.get("https://api.render.com/v1/services", {
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Accept": "application/json"
            },
            timeout: 10000
        });

        const services = Array.isArray(response.data) ? response.data : [];
        const deployments = [];

        for (const serviceWrapper of services) {
            try {
                const service = serviceWrapper.service || serviceWrapper;
                
                if (!service || !service.id) {
                    continue;
                }

                const serviceId = service.id;
                const serviceName = service.name;

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
                console.error(`Error fetching deploys:`, deployError.message);
            }
        }

        res.json(deployments);
    } catch (error) {
        console.error("Render API error:", error.message);
        
        if (error.response?.status === 401) {
            res.status(401).json({ 
                error: "Unauthorized - Check your Render API key"
            });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Dashboard route
app.get("/dashboard", requireAuth, async (req, res) => {
    const { url } = req.query;
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
        let serverHealth, logs, deployments;
        
        if (req.session.isGuest) {
            // Return mock guest data
            serverHealth = await checkServerHealth(true);
            logs = GUEST_LOGS;
            deployments = GUEST_DEPLOYMENTS;
        } else {
            serverHealth = await checkServerHealth(false);
            logs = await Log.find().sort({ timestamp: -1 });
            deployments = await Deployment.find().sort({ timestamp: -1 });
        }

        res.render('dashboard', {
            url: url || "N/A",
            urlStatus,
            pipelineStatus: PIPELINE_STATUS,
            serverHealth,
            logs,
            deployments,
            isGuest: req.session.isGuest || false
        });
    } catch (error) {
        console.error("Dashboard error:", error);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
});

// Auto health check (only for authenticated users)
setInterval(async () => {
    try {
        // Only run auto checks for non-guest sessions
        // In a production app, you'd track active sessions
        await checkServerHealth(false);
        console.log("Auto health check completed.");
    } catch (err) {
        console.error("Auto health check failed:", err);
    }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
