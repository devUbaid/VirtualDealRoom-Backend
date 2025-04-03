require("dotenv").config(); // Load environment variables at the top

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const Redis = require("ioredis");
const connectRedis = require("connect-redis");
const session = require("express-session");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const dealRoutes = require("./routes/deals");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");

// Import socket handler
const socketHandler = require("./socket");

// Create Express app
const app = express();
const server = http.createServer(app);

// Set up Socket.io
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Set up Redis client
const RedisStore = require("connect-redis").default;

const redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

redisClient.on("error", (err) => {
  console.error("Redis error:", err);
  setTimeout(() => redisClient.connect(), 5000); // Retry connection
});

redisClient.on("connect", () => {
  console.log("Connected to Redis");
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(helmet());
app.use(morgan("dev"));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later",
});
app.use("/api/", limiter);

// Session middleware with Redis
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET || "secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  }),
);

// Set up socket handler
socketHandler(io, redisClient);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/deals", dealRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

// Serve static assets in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));

  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "../client/build", "index.html"));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Server Error",
    error: process.env.NODE_ENV === "production" ? {} : err,
  });
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");

    // Start server
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down server...");
  await redisClient.quit();
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

// Export for testing
module.exports = { app, server };
