const keytar = require("keytar");
const SERVICE = "site-analyzer";

module.exports = function registerIntegrations(io, socket) {
  // Save a key: { projectId, service, key }
  socket.on("integrations:setKey", async (data) => {
    try {
      if (!data || !data.service) return;
      const projectId = data.projectId; // keep for response only
      // Store key globally (no per-project account). Account name is just the service.
      const account = `${data.service}`;
      if (!data.key || data.key === "") {
        // Empty key -> delete
        await keytar.deletePassword(SERVICE, account);
        socket.emit("integrations:deleted", {
          projectId,
          service: data.service,
        });
        return;
      }
      await keytar.setPassword(SERVICE, account, data.key);
      socket.emit("integrations:setKey:ok", {
        projectId,
        service: data.service,
      });
    } catch (err) {
      console.error("integrations:setKey error", err);
      socket.emit("integrations:setKey:error", { error: String(err) });
    }
  });

  // Get info about a key: { projectId, service }
  socket.on("integrations:get", async (data) => {
    try {
      if (!data || !data.service) return;
      const projectId = data.projectId; // echo back for UI filtering
      // Read key from global account (service only)
      const account = `${data.service}`;
      const secret = await keytar.getPassword(SERVICE, account);
      const hasKey = !!secret;
      let maskedKey = null;
      if (secret) {
        maskedKey = `${secret.slice(0, 4)}...${secret.slice(-4)}`;
      }
      socket.emit("integrations:info", {
        projectId,
        service: data.service,
        hasKey,
        maskedKey,
        // no updated_at since keytar has no metadata
      });
    } catch (err) {
      console.error("integrations:get error", err);
      socket.emit("integrations:get:error", { error: String(err) });
    }
  });

  // Delete key: { projectId, service }
  socket.on("integrations:delete", async (data) => {
    try {
      if (!data || !data.service) return;
      const projectId = data.projectId; // echo back for UI
      const account = `${data.service}`;
      await keytar.deletePassword(SERVICE, account);
      socket.emit("integrations:deleted", { projectId, service: data.service });
    } catch (err) {
      console.error("integrations:delete error", err);
      socket.emit("integrations:delete:error", { error: String(err) });
    }
  });

  // Master key management kept as no-op (master key stored in env or handled elsewhere)
  socket.on("integrations:setMasterKey", async (data) => {
    // For safety, just echo back that master-key operation is unsupported here.
    socket.emit("integrations:masterKey:ok", { hasKey: false });
  });

  socket.on("integrations:getMasterKeyInfo", async () => {
    socket.emit("integrations:masterKey:info", { hasKey: false });
  });
};
