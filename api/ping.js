/**
 * api/ping.js - Tiny, dependency-free health probe for Vercel functions
 */

export default async function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    ok: true,
    node: process.version,
    region: process.env.VERCEL_REGION || null,
  }));
}
