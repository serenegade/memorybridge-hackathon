const axios = require('axios');
const { createSurfaceText } = require('./surface');
const { summarizeVisitWithKimi } = require('./kimi');

async function extractVisitMemory({ visitorId, transcript, faceMatch }) {
  // prefer external Kimi summarizer when configured
  let summary = null;
  try {
    summary = await summarizeVisitWithKimi(transcript);
  } catch (err) {
    summary = null;
  }
  if (!summary) summary = await synthesizeSummary(transcript);
  const timestamp = new Date().toISOString();
  const surfaceText = createSurfaceText({
    visitorName: faceMatch?.name || 'visitor',
    relationship: faceMatch?.relationship || 'friend',
    lastVisit: faceMatch?.lastVisit || 'some time ago',
  });

  return {
    visitorId,
    transcript,
    faceMatch,
    summary,
    surfaceText,
    notes: `Visit captured at ${timestamp}`,
    timestamp,
  };
}

async function synthesizeSummary(transcript) {
  if (!transcript) return '';
  const lines = transcript.split(/[\.\n]/).filter(Boolean);
  const snippet = lines.slice(0, 3).join('. ').trim();
  return snippet || transcript.substring(0, 120);
}

module.exports = { extractVisitMemory };
