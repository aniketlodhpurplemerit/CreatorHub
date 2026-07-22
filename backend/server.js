const path = require('path');
const dotenv = require('dotenv');

// Monorepo root `.env` / `.env.local`, then package-level overrides.
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const creatorRoutes = require('./routes/creatorRoutes');
const moderationRoutes = require('../frontend/Moderation/routes');
const adminManagementRoutes = require('../frontend/AdminManagement/routes/admin.routes');
const userSupportRoutes = require('../frontend/UserSupport/routes/userTicket.routes');
const supportTicketRoutes = require('../frontend/SupportTickets/routes/ticket.routes');
const { initCronJobs } = require('./config/cronJobs');
const reportsRoutes = require('./src/modules/reports/reports.routes');
const appealsRoutes = require('./src/modules/appeals/appeals.routes');
const { assertJwtSecretStrengthAtStartup } = require('./utils/authSecurity');

try {
  assertJwtSecretStrengthAtStartup();
} catch (error) {
  console.error(`Startup aborted: ${error.message}`);
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

// Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  },
});

// Initialize Socket.IO signaling handlers
require('./config/socket')(io);

// Make io accessible to route handlers if needed
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DB Connection
connectDB();
initCronJobs();

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/creator', creatorRoutes);
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/livestream', require('./routes/livestreamRoutes'));
app.use('/api/moderation', moderationRoutes);
app.use('/api/admin-management', adminManagementRoutes);
app.use('/api/support/user', userSupportRoutes);
app.use('/api/support', supportTicketRoutes);
app.use('/api', reportsRoutes);
app.use('/api', appealsRoutes);

app.get('/', (req, res) => {
  res.send('API running...');
});

const PORT = process.env.PORT || 5002;
server.listen(PORT, () => {
  console.log(`Server started on port ${PORT} (HTTP + WebSocket)`);
});
