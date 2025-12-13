# Quick Start Guide

## Development (Local)

1. **Start the application**
   ```bash
   npm start
   ```
   
2. **Access the dashboard**
   - Open http://localhost:3000
   - Choose "Guest Mode" for demo (no setup required)
   - Or upload your `.env` file for full features

---

## Production Deployment

### Step 1: Environment Setup

Create a `.env` file for the **server** (not uploaded via UI):

```bash
# CRITICAL: Generate a secure session secret
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo "SESSION_SECRET=$SESSION_SECRET" >> .env

# CRITICAL: Session database (required for production)
echo "SESSION_MONGO_URI=mongodb://your-session-db-url/sessions" >> .env

# Set production mode
echo "NODE_ENV=production" >> .env

# Application port (optional)
echo "PORT=3000" >> .env
```

### Step 2: Deploy

```bash
npm install
NODE_ENV=production node app.js
```

### Step 3: Verify

Check startup logs:
- ✅ **Good:** `✓ Using MongoDB session store`
- ⚠️ **Bad:** `Using MemoryStore for sessions` (not production-ready)

---

## User .env File Format

Users upload their database credentials via the web UI:

```env
# MongoDB for user's data
MONGO_URI=mongodb://user-database-url/mydata

# API key for dashboard access
API_KEY=my-secret-api-key

# Optional: Render API integration
RENDER_API_KEY=rnd_xxx

# Optional: Custom port (usually not needed)
PORT=3000
```

---

## Architecture Overview

```
User Browser → Upload .env → Session Created → Isolated DB Connection
     ↓
Dashboard (User's data only, isolated from other users)
```

### Key Features
- ✅ **Multi-tenant:** Each user has isolated database connection
- ✅ **Secure:** Cryptographically secure sessions
- ✅ **Portable:** Guest mode works anywhere (no database required)
- ✅ **Production-ready:** MongoStore for persistent sessions

---

## Common Issues

### Issue: "Using MemoryStore for sessions"
**Solution:** Set `SESSION_MONGO_URI` environment variable

### Issue: "Cannot connect to MongoDB"
**Solution:** Verify MongoDB is running and connection string is correct

### Issue: Guest mode not working
**Solution:** Guest mode is fully in-memory and should always work. Check browser console for errors.

---

## Security Checklist

Before deploying to production:

- [ ] Set `SESSION_SECRET` (32+ random characters)
- [ ] Set `SESSION_MONGO_URI` (for persistent sessions)
- [ ] Set `NODE_ENV=production` (enables HTTPS-only cookies)
- [ ] Use HTTPS in production (reverse proxy with SSL)
- [ ] Never commit `.env` files to version control

---

## Monitoring

### Startup Logs
```bash
✓ Using MongoDB session store          # Good - production ready
⚠️ Using MemoryStore                    # Warning - dev only
Server running on http://localhost:3000 # Application started
```

### Connection Pool
- Each user session maintains its own database connection
- Connections automatically cleaned up on logout
- Stale connections removed every 5 minutes

---

## Need Help?

See [ARCHITECTURE_IMPROVEMENTS.md](./ARCHITECTURE_IMPROVEMENTS.md) for detailed technical documentation.
