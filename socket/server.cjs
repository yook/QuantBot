// Socket server module for Electron integration
const express = require("express");
const http = require("http");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

// Import handlers
const registerProject = require("./HandlerProject.cjs");
const registerCrawler = require("./HandlerCrawler.cjs");
const registerKeywords = require("./HandlerKeywords.cjs");
const registerCategories = require("./HandlerCategories.cjs");
const registerIntegrations = require("./HandlerIntegrations.cjs");
const registerTyping = require("./HandlerTyping.cjs");

let socketServer = null;
let httpServer = null;
let activeConnections = 0;
// Track one active connection per renderer instance
const connectionsByInstanceId = new Map(); // clientInstanceId -> socket.id

function startSocketServer(port = 8090) {
  if (socketServer) {
    console.log("Socket server already running");
    return socketServer;
  }

  // Определяем dev режим
  const isDev = process.env.NODE_ENV !== "production";
  const PORT = port || (isDev ? 8090 : 8000);

  console.log(
    `Starting Socket.IO server in ${
      isDev ? "development" : "production"
    } mode on port ${PORT}`
  );

  const app = express();
  httpServer = http.createServer(app);

  const io = require("socket.io")(httpServer, {
    maxHttpBufferSize: 1e8,
    cors: {
      origin: "*",
    },
    // Use a custom path to avoid collisions with other dev tooling
    path: "/quantbot-socket",
  });

  app.use(bodyParser.json({ limit: "50mb" }));
  app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
  app.use(cors());

  // Register socket handlers
  io.on("connection", (socket) => {
    const clientInstanceId = socket.handshake?.query?.clientInstanceId;
    const userAgent = socket.handshake?.headers?.["user-agent"];

    // Reject unknown clients (no instance id) to avoid stray connections
    if (!clientInstanceId) {
      console.warn(
        "Rejecting socket without clientInstanceId:",
        socket.id,
        userAgent ? `(ua=${userAgent})` : ""
      );
      try {
        socket.disconnect(true);
      } catch (_) {}
      return; // don't register handlers
    }

    // Enforce single active connection per clientInstanceId
    const prevSocketId = connectionsByInstanceId.get(clientInstanceId);
    if (prevSocketId && prevSocketId !== socket.id) {
      const prevSocket = io.sockets.sockets.get(prevSocketId);
      if (prevSocket) {
        console.log(
          `Duplicate clientInstanceId detected (${clientInstanceId}). Replacing old socket ${prevSocketId} with ${socket.id}`
        );
        try {
          prevSocket.disconnect(true);
        } catch (_) {}
      }
    }
    connectionsByInstanceId.set(clientInstanceId, socket.id);

    // Count only accepted connections
    activeConnections += 1;
    console.log(
      "New socket connection:",
      socket.id,
      clientInstanceId ? `(client=${clientInstanceId})` : "",
      userAgent ? `(ua=${userAgent})` : ""
    );
    console.log("Active socket connections:", activeConnections);

    // Register all handlers
    registerProject(io, socket);
    registerCrawler(io, socket);
    registerKeywords(io, socket);
    registerCategories(io, socket);
    registerIntegrations(io, socket);
    registerTyping(io, socket);

    socket.on("disconnect", () => {
      // cleanup instance tracking
      if (
        clientInstanceId &&
        connectionsByInstanceId.get(clientInstanceId) === socket.id
      ) {
        connectionsByInstanceId.delete(clientInstanceId);
      }
      activeConnections = Math.max(0, activeConnections - 1);
      console.log("Socket disconnected:", socket.id);
      console.log("Active socket connections:", activeConnections);
    });
  });

  // Start server
  httpServer.listen(PORT, () => {
    console.log(`Socket.IO server listening on port ${PORT}`);
  });

  socketServer = io;
  return io;
}

function stopSocketServer() {
  if (httpServer) {
    httpServer.close(() => {
      console.log("Socket server stopped");
    });
    httpServer = null;
  }
  if (socketServer) {
    socketServer.close();
    socketServer = null;
  }
}

function getSocketServer() {
  return socketServer;
}

// If this file is run directly, start the server
if (require.main === module) {
  startSocketServer();

  // Handle graceful shutdown
  process.on("SIGTERM", () => {
    console.log("Received SIGTERM, shutting down gracefully");
    stopSocketServer();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("Received SIGINT, shutting down gracefully");
    stopSocketServer();
    process.exit(0);
  });
}

module.exports = {
  startSocketServer,
  stopSocketServer,
  getSocketServer,
};
