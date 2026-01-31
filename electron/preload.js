// Security bridge — currently minimal
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    platform: process.platform,
});