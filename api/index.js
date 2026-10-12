/**
 * api/index.js - Vercel Serverless Function entry point
 * Bitget AI Hackathon S2 - VT2 Hosted Demo Mode
 */

let serverInstance = null;
let initError = null;

async function getOrCreateServer() {
  if (initError) {
    throw initError;
  }
  if (!serverInstance) {
    try {
      process.env.DEPLOY_MODE = 'DEMO_READONLY';
      process.env.VERCEL = '1';

      const { VT2Server } = await import('../src/server.js');
      serverInstance = new VT2Server({
        demoReadOnly: true,
        disableWs: true,
        disableMonitor: true,
      });
    } catch (err) {
      initError = err;
      console.error('[VT2 Demo Init Error]:', err);
      throw err;
    }
  }
  return serverInstance;
}

export default async function handler(req, res) {
  try {
    const server = await getOrCreateServer();
    return await server.handleRequest(req, res);
  } catch (err) {
    console.error('[VT2 Demo Handler Error]:', err);
    const stackLines = (err?.stack || '').split('\n').slice(0, 6);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'DEMO_INIT_FAILED',
        name: err?.name || 'Error',
        message: err?.message || String(err),
        stack: stackLines,
      }));
    }
  }
}
