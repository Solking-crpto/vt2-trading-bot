import { VT2Server } from '../src/server.js';

let serverInstance = null;

export default async function handler(req, res) {
  if (!serverInstance) {
    serverInstance = new VT2Server({
      demoReadOnly: true,
      disableWs: true,
      disableMonitor: true,
    });
  }
  return serverInstance.handleRequest(req, res);
}
