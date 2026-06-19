import http from "node:http";
import { createExpressApp } from "./server/index";

const port = Number(process.env.NEXO_WEB_PORT || "9898");
const host = process.env.NEXO_WEB_HOST || "0.0.0.0";

const app = createExpressApp(() => process.env.NEXO_API_KEY || "");
const server = http.createServer(app);

server.listen(port, host, () => {
  console.log(`Nexo Agent web console: http://localhost:${port}`);
});
