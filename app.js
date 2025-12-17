const express = require("express");
const axios = require("axios");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const session = require("express-session");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");

const app = express();

// Configure multer for in-memory file storage
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('stylesheets'));

// Generate secure session secret from environment or create random one
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (SESSION_SECRET.length < 32) {
    console.warn("⚠️  WARNING: SESSION_SECRET should be at least 32 characters for production!");
}

// Session configuration with optional MongoStore for production
let sessionConfig = {
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 30 * 60 * 1000, // 30 minutes
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' // Auto-enable in production
    }
};

// Try to use MongoStore if SESSION_MONGO_URI is provided
if (process.env.SESSION_MONGO_URI) {
    try {
        const MongoStore = require("connect-mongo");
        sessionConfig.store = MongoStore.create({
            mongoUrl: process.env.SESSION_MONGO_URI,
            touchAfter: 24 * 3600 // Lazy session update
        });
        console.log("✓ Using MongoDB session store");
    } catch (err) {
        console.warn("⚠️  MongoDB session store unavailable, using MemoryStore (not for production!)");
        console.warn("   Error:", err.message);
    }
} else {
    console.warn("⚠️  Using MemoryStore for sessions (not suitable for production)");
    console.warn("   Set SESSION_MONGO_URI environment variable to use persistent session storage");
}

app.use(session(sessionConfig));

// Guest mode default configuration - fully in-memory, no database required
const GUEST_CONFIG = {
    API_KEY: "guest-api-key-12345",
    RENDER_API_KEY: "",
    PORT: 3000
};

// In-memory storage for guest mode (per session)
const guestStorage = new Map();

function getGuestData(sessionId) {
    if (!guestStorage.has(sessionId)) {
        guestStorage.set(sessionId, {
            servers: [
                { name: "Demo Server 1", url: "https://httpstat.us/200", status: "Up" },
                { name: "Demo Server 2", url: "https://httpstat.us/500", status: "Down" }
            ],
            logs: [
                {
                    timestamp: new Date(Date.now() - 60000),
                    statuses: {
                        "Demo Server 1": { status: "Up", reason: "OK 200" },
                        "Demo Server 2": { status: "Down", reason: "HTTP 500" }
                    }
                }
            ],
            deployments: [
                {
                    version: "v1.0.0",
                    status: "success",
                    timestamp: new Date(Date.now() - 120000),
                    provider: "manual",
                    project: "Demo Project",
                    environment: "production"
                }
            ]
        });
    }
    return guestStorage.get(sessionId);
}

// Parse .env content using battle-tested dotenv parser
// Handles multiline values, special characters, quotes, and edge cases properly
function parseEnvContent(buffer) {
    return dotenv.parse(buffer);
}

// MongoDB Connection Pool Manager - Per Session Isolation
// This fixes the critical multi-tenancy flaw by creating separate connections per session
const connectionPool = new Map();

async function getConnection(sessionId, mongoUri) {
    if (!sessionId || !mongoUri) {
        throw new Error("Session ID and MongoDB URI are required");
    }
    
    const connectionKey = `${sessionId}:${mongoUri}`;
    
    if (connectionPool.has(connectionKey)) {
        const conn = connectionPool.get(connectionKey);
        if (conn.readyState === 1) { // Connected
            return conn;
        } else {
            // Connection is dead, remove it
            connectionPool.delete(connectionKey);
        }
    }
    
    try {
        // Create a NEW connection instance for this session
        const conn = mongoose.createConnection(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 5
        });
        
        await conn.asPromise();
        connectionPool.set(connectionKey, conn);
        console.log(`Created new MongoDB connection for session ${sessionId.substring(0, 8)}...`);
        return conn;
    } catch (err) {
        console.error("MongoDB connection error:", err);
        throw err;
    }
}

// Cleanup old connections periodically
setInterval(() => {
    for (const [key, conn] of connectionPool.entries()) {
        if (conn.readyState !== 1) {
            conn.close().catch(console.error);
            connectionPool.delete(key);
        }
    }
}, 5 * 60 * 1000); // Every 5 minutes

// MongoDB schemas (will be instantiated per connection)
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

// Get models for a specific connection (session-isolated)
function getModels(connection) {
    return {
        Server: connection.model("Server", ServerSchema),
        Log: connection.model("Log", LogSchema),
        Deployment: connection.model("Deployment", DeploymentSchema)
    };
}

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

// Health check function - supports both guest mode and authenticated mode
const checkServerHealth = async (sessionId, isGuest = false, connection = null) => {
    let statuses = {};
    try {
        if (isGuest) {
            // Use in-memory guest data
            const guestData = getGuestData(sessionId);
            for (let server of guestData.servers) {
                statuses[server.name] = { 
                    status: server.status, 
                    reason: server.status === "Up" ? "OK 200" : "Connection failed" 
                };
            }
            return statuses;
        }
        
        if (!connection) {
            throw new Error("Database connection required for authenticated mode");
        }
        
        const { Server, Log } = getModels(connection);
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
        
        // Parse the uploaded .env file using dotenv (handles edge cases)
        const config = parseEnvContent(req.file.buffer);
        
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
        
        // Test connection (will be created per-session on demand)
        try {
            const testConn = await getConnection(req.sessionID, config.MONGO_URI);
            console.log(`User ${req.sessionID.substring(0, 8)}... connected successfully`);
        } catch (err) {
            console.error("Connection test failed:", err);
            return res.redirect('/?error=db_connection_failed');
        }
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error("Upload error:", error);
        res.redirect('/?error=upload_failed');
    }
});

// Guest mode route - fully in-memory, no database needed
app.post("/guest-mode", async (req, res) => {
    try {
        req.session.config = GUEST_CONFIG;
        req.session.isGuest = true;
        
        // Initialize guest data for this session
        getGuestData(req.sessionID);
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error("Guest mode error:", error);
        res.redirect('/?error=guest_mode_failed');
    }
});

// Logout route - clear session and cleanup connections
app.get("/logout", async (req, res) => {
    const sessionId = req.sessionID;
    
    // Cleanup guest data
    if (guestStorage.has(sessionId)) {
        guestStorage.delete(sessionId);
    }
    
    // Cleanup database connections for this session
    for (const [key, conn] of connectionPool.entries()) {
        if (key.startsWith(sessionId)) {
            try {
                await conn.close();
                connectionPool.delete(key);
                console.log(`Closed connection for session ${sessionId.substring(0, 8)}...`);
            } catch (err) {
                console.error("Connection cleanup error:", err);
            }
        }
    }
    
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
        let connection = null;
        if (!req.session.isGuest) {
            connection = await getConnection(req.sessionID, req.session.config.MONGO_URI);
        }
        
        const serverHealth = await checkServerHealth(req.sessionID, req.session.isGuest, connection);
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
    
    try {
        const connection = await getConnection(req.sessionID, req.session.config.MONGO_URI);
        const { Deployment } = getModels(connection);
        
        PIPELINE_STATUS = "in_progress";
        const deployment = new Deployment({ version, status: "in_progress", timestamp: new Date() });
        await deployment.save();

        setTimeout(async () => {
            PIPELINE_STATUS = "success";
            deployment.status = "success";
            await deployment.save();
        }, 2000);

        res.json({ message: "Deployment triggered", status: PIPELINE_STATUS, version });
    } catch (error) {
        res.status(500).json({ message: "Deployment failed", error: error.message });
    }
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
        const connection = await getConnection(req.sessionID, req.session.config.MONGO_URI);
        const { Server } = getModels(connection);
        
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
app.delete("/servers/:name", requireAuth, async (req, res) => {
    if (req.session.isGuest) {
        return res.status(403).json({ message: "Cannot delete servers in guest mode" });
    }
    
    const { name } = req.params;
    try {
        const connection = await getConnection(req.sessionID, req.session.config.MONGO_URI);
        const { Server } = getModels(connection);
        
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
        const connection = await getConnection(req.sessionID, req.session.config.MONGO_URI);
        const { Log } = getModels(connection);
        
        await Log.deleteMany({});
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Delete logs error:', err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

// Render webhook endpoint
// Note: Webhooks don't have session context, so this needs special handling
// For now, webhooks will use a default connection or be disabled
app.post("/webhooks/render", async (req, res) => {
    try {
        const payload = req.body;
        console.log("Render webhook received:", JSON.stringify(payload, null, 2));
        
        // Webhooks are stateless and don't have session context
        // You would need to authenticate webhooks differently (e.g., webhook secret)
        // For now, we'll just acknowledge receipt
        console.warn("Webhook storage disabled in multi-tenant mode - implement webhook authentication");
        
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
            const guestData = getGuestData(req.sessionID);
            return res.json(guestData.deployments);
        }
        
        const connection = await getConnection(req.sessionID, req.session.config.MONGO_URI);
        const { Deployment } = getModels(connection);
        
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
            // Use in-memory guest data
            const guestData = getGuestData(req.sessionID);
            serverHealth = await checkServerHealth(req.sessionID, true);
            logs = guestData.logs;
            deployments = guestData.deployments;
        } else {
            // Use per-session database connection
            const connection = await getConnection(req.sessionID, req.session.config.MONGO_URI);
            const { Log, Deployment } = getModels(connection);
            
            serverHealth = await checkServerHealth(req.sessionID, false, connection);
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

// Auto health check disabled in multi-tenant mode
// In production, use a proper job queue system (Bull, Agenda) with per-user tasks
// Global interval timers don't work with per-session isolation
console.log("Note: Auto health checks disabled in multi-tenant mode. Implement per-user job scheduling for production.");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
