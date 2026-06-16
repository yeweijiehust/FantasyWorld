process.env.DATA_STORE = "memory";
process.env.PORT = "4100";

await import("../src/server.js");
