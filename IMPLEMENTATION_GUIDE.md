# DevOps Dashboard - Secure Session-Based Credential System

## Overview
This implementation provides a secure, session-based credential management system where users upload their `.env` file through the web interface instead of storing it in the project folder. The system includes:

1. **Session-based credential storage** - Credentials stored in memory only
2. **30-minute session timeout** - Auto-expiration for security
3. **Guest mode** - Read-only access with sample data
4. **No disk storage** - .env file processed in-memory only
5. **Protected routes** - Dashboard and API routes require authentication

## Installation

### 1. Install new dependencies:
```bash
npm install express-session multer
```

### 2. Replace files:
- Replace `app.js` with `app_updated.js`
- Replace `views/index.ejs` with `views/index_updated.ejs`
- Replace `views/dashboard.ejs` with `views/dashboard_updated.ejs`

Or rename the updated files:
```bash
# Backup originals
mv app.js app_backup.js
mv views/index.ejs views/index_backup.ejs
mv views/dashboard.ejs views/dashboard_backup.ejs

# Rename updated files
mv app_updated.js app.js
mv views/index_updated.ejs views/index.ejs
mv views/dashboard_updated.ejs views/dashboard.ejs
```

## How It Works

### 1. Landing Page (`/`)
- Users see a beautiful upload interface
- Can drag-and-drop or click to upload `.env` file
- Or continue as guest with sample data
- Shows error messages if upload fails

### 2. File Upload Process
- `.env` file uploaded via `POST /upload-env`
- File is **never saved to disk** - processed in memory only
- Credentials extracted and stored in session
- MongoDB connection established with user's MONGO_URI
- Session expires after 30 minutes of inactivity

### 3. Guest Mode
- Users can click "Continue as Guest"
- Connects to a guest MongoDB database
- Shows sample preset data (servers, logs, deployments)
- All write operations disabled
- Yellow banner indicates guest mode

### 4. Authenticated Mode
- Full access to all features
- Can add/remove servers
- Can trigger deployments
- Can delete logs
- Green banner shows authenticated status
- "Logout" button to clear session

### 5. Session Management
- Session expires after 30 minutes
- After expiration, redirected to upload page
- Can logout manually anytime
- Credentials cleared on logout

## Required .env File Format

Your `.env` file must contain:

```env
# Required
MONGO_URI=mongodb://localhost:27017/your_database
API_KEY=your-secure-api-key-here

# Optional
RENDER_API_KEY=your-render-api-key
PORT=3000
```

## Features

### Security Features
- ✅ No `.env` file stored on disk
- ✅ Credentials in session memory only
- ✅ 30-minute session timeout
- ✅ Session cookies HttpOnly flag
- ✅ Protected routes require authentication
- ✅ Guest mode for safe preview

### User Experience
- ✅ Drag-and-drop file upload
- ✅ Clear error messages
- ✅ Guest mode with sample data
- ✅ Visual indicators (guest vs authenticated)
- ✅ Session status display
- ✅ Easy logout/re-upload

### Guest Mode Limitations
- ❌ Cannot add servers
- ❌ Cannot remove servers
- ❌ Cannot trigger deployments
- ❌ Cannot delete logs
- ❌ Cannot view Render API data
- ✅ Can view sample data
- ✅ Can check URLs

## API Endpoints

### Public Endpoints
- `GET /` - Landing page with upload form
- `POST /upload-env` - Upload .env file
- `POST /guest-mode` - Enter guest mode
- `POST /webhooks/render` - Render webhook (no auth)

### Protected Endpoints (require session)
- `GET /dashboard` - Main dashboard
- `GET /status` - System status
- `POST /deploy` - Trigger deployment (authenticated only)
- `POST /servers` - Add server (authenticated only)
- `DELETE /servers/:name` - Remove server (authenticated only)
- `POST /logs_delete` - Clear logs (authenticated only)
- `GET /deployments` - View deployments
- `GET /render-deployments` - Fetch Render API data (authenticated only)
- `GET /logout` - Clear session and logout

## File Structure

```
devops_project/
├── app.js                  # Main application with session management
├── package.json            # Updated with new dependencies
├── views/
│   ├── index.ejs          # Upload page with file upload form
│   └── dashboard.ejs      # Dashboard with guest/auth indicators
├── stylesheets/
│   └── styles.css
└── ... (other files)
```

## Testing

### Test Upload Flow
1. Start the server: `npm start`
2. Navigate to `http://localhost:3000`
3. Create a test `.env` file with required fields
4. Upload the file
5. Verify you're redirected to dashboard
6. Check the green "Authenticated" banner

### Test Guest Mode
1. Navigate to `http://localhost:3000`
2. Click "Continue as Guest"
3. Verify yellow "Guest Mode" banner appears
4. Verify sample data is displayed
5. Verify buttons are disabled

### Test Session Expiry
1. Upload .env and access dashboard
2. Wait 30 minutes
3. Try to access `/dashboard` or any protected route
4. Verify redirect to upload page with error message

### Test Logout
1. Click "Logout" button
2. Verify redirect to upload page
3. Try accessing `/dashboard` - should require re-upload

## Production Considerations

### Before deploying to production:

1. **Change the session secret** in app.js:
```javascript
session({
    secret: 'your-secret-key-change-this-in-production', // CHANGE THIS!
    // ...
})
```

2. **Enable HTTPS** and set secure cookie:
```javascript
cookie: { 
    secure: true,  // Only send over HTTPS
    httpOnly: true,
    // ...
}
```

3. **Use a session store** (Redis, MongoDB) instead of memory:
```javascript
const session = require('express-session');
const MongoStore = require('connect-mongo');

app.use(session({
    // ...
    store: MongoStore.create({ mongoUrl: 'your-mongo-url' })
}));
```

4. **Rate limit the upload endpoint**:
```javascript
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5 // 5 uploads per 15 minutes
});
app.post("/upload-env", uploadLimiter, upload.single('envFile'), ...);
```

5. **Validate .env file content more strictly**
6. **Add file size limits** (already configured in multer)
7. **Add logging** for security auditing

## Troubleshooting

### Issue: "Upload failed" error
- Check if MONGO_URI is valid and MongoDB is running
- Verify .env file format is correct
- Check browser console for detailed errors

### Issue: Session expires too quickly
- Increase `maxAge` in session config (currently 30 minutes)
- Check if cookies are being blocked by browser

### Issue: Guest mode not showing data
- Check if guest MongoDB is accessible
- Verify GUEST_CONFIG in app.js

### Issue: Cannot access dashboard
- Clear browser cookies and try again
- Check if session middleware is properly configured
- Verify no errors in server logs

## Updates Made

### package.json
- Added `express-session` for session management
- Added `multer` for file upload handling

### app.js
- Complete rewrite with session support
- Added file upload handling
- Added .env parsing function
- Added guest mode configuration
- Added requireAuth middleware
- Updated all routes to check session
- Added logout route
- Session-based MongoDB connection

### views/index.ejs
- Complete redesign as upload page
- Drag-and-drop file upload
- Guest mode button
- Error message display
- Beautiful gradient design

### views/dashboard.ejs
- Added guest/authenticated banners
- Disabled features in guest mode
- Logout button
- Session status indicators
- Updated JavaScript to handle guest mode

## Security Benefits

1. **No credential leaks**: .env never saved to disk
2. **Time-limited access**: 30-minute session timeout
3. **Guest preview**: Safe exploration without credentials
4. **Session isolation**: Each user's session is separate
5. **Memory-only storage**: Credentials cleared on restart
6. **Logout capability**: Manual session termination

## Summary

This implementation transforms your DevOps dashboard into a secure, multi-user system where:
- ✅ Credentials are never exposed in the project folder
- ✅ Each user uploads their own .env file
- ✅ Sessions automatically expire for security
- ✅ Guest mode allows safe preview
- ✅ All operations are properly authenticated
- ✅ Clear visual feedback on authentication status

The system is production-ready with minor modifications (session secret, HTTPS, session store).
