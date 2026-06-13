const axios = require('axios');

// Lightweight Kimi / TokenRouter integration stub.
// If KIMI_KEY and TOKEN_ROUTER_URL are set, this will attempt to call the configured
// summarizer. Otherwise it returns a local fallback summary.

async function summarizeVisitWithKimi(transcript) {
  const kimiKey = process.env.KIMI_KEY;
  const tokenRouterUrl = process.env.TOKEN_ROUTER_URL;
  const tokenRouterKey = process.env.TOKEN_ROUTER_KEY;

  if (kimiKey && tokenRouterUrl && tokenRouterKey) {
    try {
      const resp = await axios.post(
        tokenRouterUrl,
        { model: 'kimi-small', input: transcript },
        { headers: { Authorization: `Bearer ${tokenRouterKey}`, 'x-kimi-key': kimiKey } }
      );
      if (resp && resp.data && resp.data.summary) return resp.data.summary;
      if (resp && resp.data && typeof resp.data === 'string') return resp.data;
    } catch (err) {
      console.warn('Kimi summarizer call failed:', err && err.message);
    }
  }

  // Fallback: very small heuristic summary
  if (!transcript) return '';
  const lines = transcript.split(/\.|\n/).map((l) => l.trim()).filter(Boolean);
  return lines.slice(0, 2).join('. ') || transcript.substring(0, 120);
}

module.exports = { summarizeVisitWithKimi };
