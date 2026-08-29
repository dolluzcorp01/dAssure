require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");

const app = express();
// TPRM_PORT, not PORT: react-scripts reads PORT from .env for the frontend
// dev server, so the two must not share a variable.
const port = process.env.TPRM_PORT || 4009;

const isProd = process.env.NODE_ENV === "production";

// Explicit production origins. dTprm is a standalone product, so the list is
// short: itself, plus Inside D which links to it from the app launcher.
const allowedOrigins = [
    'https://dtprm.dolluzcorp.com',
    'https://inside.dolluzcorp.com',
    'https://dadmin.dolluzcorp.com',
    'https://dolluzcorp.com',
];

const isLocalhostOrigin = (origin) =>
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const clean = origin.replace(/\/$/, '');
        if (allowedOrigins.includes(clean)) return callback(null, true);
        if (!isProd && isLocalhostOrigin(clean)) return callback(null, true);
        console.error("❌ Blocked by CORS:", origin);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Evidence and generated workbooks live on disk under this folder. Create it
// on boot so a fresh clone works without any manual mkdir.
const STORAGE_DIR = process.env.TPRM_STORAGE_DIR || path.join(__dirname, 'TPRM_file_uploads');
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// Routes
const LoginRoutes = require('./src/backend_routes/TPRM_Login_server');
const ClientsRoutes = require('./src/backend_routes/TPRM_Clients_server');
const LibraryRoutes = require('./src/backend_routes/TPRM_Library_server');
const VendorsRoutes = require('./src/backend_routes/TPRM_Vendors_server');
const AssessmentsRoutes = require('./src/backend_routes/TPRM_Assessments_server');
const DistributionRoutes = require('./src/backend_routes/TPRM_Distribution_server');
const EvidenceRoutes = require('./src/backend_routes/TPRM_Evidence_server');
const FindingsRoutes = require('./src/backend_routes/TPRM_Findings_server');
const ReportsRoutes = require('./src/backend_routes/TPRM_Reports_server');
const AuditRoutes = require('./src/backend_routes/TPRM_Audit_server');
const { startMailWorker } = require('./src/backend_routes/utils/tprm_mailer');
const { logError } = require('./src/backend_routes/utils/tprm_log');

app.use("/api/tprm/login", LoginRoutes.router);
app.use("/api/tprm/clients", ClientsRoutes);
app.use("/api/tprm/library", LibraryRoutes);
app.use("/api/tprm/vendors", VendorsRoutes);
app.use("/api/tprm/assessments", AssessmentsRoutes);
app.use("/api/tprm/distribution", DistributionRoutes);
app.use("/api/tprm/evidence", EvidenceRoutes);
app.use("/api/tprm/findings", FindingsRoutes);
app.use("/api/tprm/reports", ReportsRoutes);
app.use("/api/tprm/audit", AuditRoutes);

// Health check - reports the database too, so a failure is diagnosable from
// one call rather than from a 500 on some unrelated endpoint.
app.get("/api/tprm/health", (req, res) => {
    const db = require('./config/db')(process.env.DB_NAME || 'dtprm');
    db.query("SELECT 1", (err) => {
        if (err) {
            logError('health check', err, req);
            return res.status(503).json({ ok: false, database: "down", error: err.code });
        }
        res.json({ ok: true, service: "dTprm", database: "up", time: new Date().toISOString() });
    });
});

app.use('/TPRM_file_uploads', express.static(STORAGE_DIR));

// Anything under /api that did not match a route above
app.use("/api", (_req, res) =>
    res.status(404).json({ error: "NOT_FOUND", message: "No such endpoint" }));

// Anything a route throws lands here and is printed like every other backend
// error. Express 5 forwards a rejected async handler automatically, so a route
// that forgot its try/catch is still reported rather than hanging the request.
app.use((err, req, res, _next) => {
    logError('unhandled route error', err, req);
    if (res.headersSent) return;
    res.status(err.status || 500).json({
        error: "SERVER_ERROR",
        message: "Something went wrong. The server log has the detail.",
    });
});

// Failures with no request behind them - a background worker, a bad await
// somewhere off the request path. Without these the process prints a bare
// stack, or in older Node exits without saying why.
process.on('unhandledRejection', (reason) => {
    logError('unhandled promise rejection',
        reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (e) => {
    logError('uncaught exception', e);
    console.error('   The process is still running but its state is no longer '
        + 'trustworthy - restart it when convenient.');
});

app.listen(port, () => {
    console.log(`🚀 dTprm server running at http://localhost:${port}`);
    // Drains tprm_mail_outbox every 60s. Nothing is lost if SendGrid is down;
    // the row stays queued and is retried on the next tick.
    startMailWorker();
});
