# Ops Monitor — README

This small Node.js Express app monitors server health and provides a dashboard with activity logs and deployment history. Below are quick start instructions and example curl commands for the routes defined in `app.js`.

## Quick start

1. Install dependencies

```bash
npm install
```

2. Create a `.env` in project root with at least these values:

```
PORT=3000
MONGO_URI=mongodb://localhost:27017/devops
API_KEY=your_api_key_here
```

3. Start the service

```bash
npm run dev   # or npm start
```

4. Visit the dashboard

```
http://localhost:3000/dashboard
```

## Notes
- Protected routes expect the API key in the header `x-api-key: <YOUR_API_KEY>`.
- The app uses MongoDB; ensure `MONGO_URI` is set to a running database.

---

## Routes & cURL examples
Replace `<YOUR_API_KEY>` and data values with the correct values for your environment.

### 1) Add a server (protected)
- Route: POST `/servers`
- Body JSON: `name`, `url`

Linux/macOS / WSL / Git Bash
```bash
curl -v -X POST http://localhost:3000/servers \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{"name":"my-server","url":"http://your-server:8080"}'
```

Windows PowerShell (Invoke-RestMethod)
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/servers -Headers @{"x-api-key"="<YOUR_API_KEY>"} -Body (@{name="my-server"; url="http://your-server:8080"} | ConvertTo-Json) -ContentType 'application/json'
```

### 2) Delete a server (protected)
- Route: DELETE `/servers/:name`

Linux/macOS
```bash
curl -v -X DELETE "http://localhost:3000/servers/my-server" -H "x-api-key: <YOUR_API_KEY>"
```

PowerShell
```powershell
Invoke-RestMethod -Method Delete -Uri "http://localhost:3000/servers/my-server" -Headers @{"x-api-key"="<YOUR_API_KEY>"}
```

### 3) Trigger a deployment (protected)
- Route: POST `/deploy`
- Body JSON: `version`

Linux/macOS
```bash
curl -v -X POST http://localhost:3000/deploy \
  -H "Content-Type: application/json" \
  -H "x-api-key: <YOUR_API_KEY>" \
  -d '{"version":"v1.2.3"}'
```

PowerShell
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/deploy -Headers @{"x-api-key"="<YOUR_API_KEY>"} -Body (@{version="v1.2.3"} | ConvertTo-Json) -ContentType 'application/json'
```

### 4) List deployments (protected)
- Route: GET `/deployments`

Linux/macOS
```bash
curl -v -X GET http://localhost:3000/deployments -H "x-api-key: <YOUR_API_KEY>"
```

PowerShell
```powershell
Invoke-RestMethod -Method Get -Uri http://localhost:3000/deployments -Headers @{"x-api-key"="<YOUR_API_KEY>"}
```

### 5) Delete all logs (protected)
- Route: POST `/logs_delete` (the frontend uses POST and sends `x-api-key` header)

Linux/macOS
```bash
curl -v -X POST http://localhost:3000/logs_delete -H "x-api-key: <YOUR_API_KEY>"
```

PowerShell
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/logs_delete -Headers @{"x-api-key"="<YOUR_API_KEY>"}
```

### 6) Check overall status (public)
- Route: GET `/status` — returns JSON with CI/CD pipeline & server health

```bash
curl -v http://localhost:3000/status
```

### 7) View Dashboard (browser view)
- Route: GET `/dashboard` (accepts query param `url` to check a remote site)

Direct URL with optional check:
```
http://localhost:3000/dashboard
http://localhost:3000/dashboard?url=https://example.com
```

---

If you want, I can add Postman collection or API docs for these endpoints, and a small UI form to add new servers from the dashboard page. Which would you like next?
a