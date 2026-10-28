const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("msvDesktop", { xhp: true });
