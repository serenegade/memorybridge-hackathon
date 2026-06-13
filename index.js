require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const { extractVisitMemory } = require('./agents/conversation');
const { saveVisit, getLastVisitForVisitor, listVisits } = require('./agents/memory');
const { loadProfiles, saveProfiles, addProfile, getRecognisedVisitor, getProfileById, findProfileByHash, findProfileByPHash, computeEmbeddingFromDataUrl, findProfileByEmbedding } = require('./agents/profiles');

const app = express();
app.use(cors());
app.use(express.json());

const videoDbApiUrl = process.env.VIDEODB_API_URL || 'https://api.videodb.io';

function requireVideoDbKey() {
  if (!process.env.VIDEODB_API_KEY) {
    const err = new Error('VIDEODB_API_KEY is not configured');
    err.statusCode = 500;
    throw err;
  }
  return process.env.VIDEODB_API_KEY;
}

function cleanName(value) {
  return String(value || 'visitor')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase() || 'visitor';
}

async function ensureVideoDbCollection(profile) {
  if (profile.videoDbCollectionId) return profile.videoDbCollectionId;

  const apiKey = requireVideoDbKey();
  const response = await axios.post(
    `${videoDbApiUrl}/collection`,
    {
      name: `MemoryBridge - ${profile.name}`,
      description: `Interaction reports for ${profile.name}`,
      is_public: false,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': apiKey,
      },
    }
  );

  const collectionId = response.data?.data?.id;
  if (!collectionId) throw new Error('VideoDB did not return a collection id');

  const profiles = loadProfiles();
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx !== -1) {
    profiles[idx].videoDbCollectionId = collectionId;
    profiles[idx].videoDbCollectionName = `MemoryBridge - ${profile.name}`;
    saveProfiles(profiles);
  }

  return collectionId;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'MemoryBridge backend' });
});

app.get('/api/profiles', (req, res) => {
  const profiles = loadProfiles();
  res.json({ profiles });
});

app.get('/api/profiles/recognised', (req, res) => {
  const profile = getRecognisedVisitor();
  if (!profile) {
    return res.status(404).json({ error: 'No recognised visitor available' });
  }

  const lastVisit = getLastVisitForVisitor(profile.id);
  res.json({ profile, lastVisit });
});

// Simple matcher: accepts `{ imageData }` (data URL) and returns profile with matching hash
app.post('/api/profiles/match', (req, res) => {
  (async () => {
    const { imageData, pHash } = req.body;
    // prefer pHash matching when provided
    if (pHash) {
      const found = findProfileByPHash(pHash);
      if (!found) return res.json({ profile: null });
      const lastVisit = getLastVisitForVisitor(found.id);
      return res.json({ profile: found, lastVisit });
    }

    if (!imageData) return res.status(400).json({ error: 'imageData (data URL) required' });

    // try embedding-based match (local model)
    try {
      const embedding = await computeEmbeddingFromDataUrl(imageData);
      if (embedding) {
        const foundEmb = findProfileByEmbedding(embedding);
        if (foundEmb) {
          const lastVisit = getLastVisitForVisitor(foundEmb.id);
          return res.json({ profile: foundEmb, lastVisit, method: 'embedding' });
        }
      }
    } catch (err) {
      // continue to hash fallback
    }

    // compute hash locally (same algorithm as saveFaceImage)
    try {
      const parts = imageData.split(',');
      if (parts.length !== 2) throw new Error('invalid data URL');
      const b64 = parts[1];
      const buf = Buffer.from(b64, 'base64');
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const found = findProfileByHash(hash);
      if (!found) return res.json({ profile: null });
      const lastVisit = getLastVisitForVisitor(found.id);
      return res.json({ profile: found, lastVisit, method: 'sha256' });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'invalid image' });
    }
  })();
});

app.post('/api/profiles', async (req, res) => {
  const { name, relationship, notes } = req.body;
  if (!name || !relationship) {
    return res.status(400).json({ error: 'name and relationship are required' });
  }
  // accept optional faceData (base64 data URL) from enrol capture
  const { faceData, facePHash } = req.body;

  try {
    let embedding = null;
    if (faceData) {
      try {
        embedding = await computeEmbeddingFromDataUrl(faceData);
      } catch (err) {
        embedding = null;
      }
    }
    const profile = addProfile({ name, relationship, notes, faceData, facePHash });
    // if we computed an embedding, persist it into the saved profile
    if (embedding && profile) {
      const profiles = loadProfiles();
      const idx = profiles.findIndex((p) => p.id === profile.id);
      if (idx !== -1) {
        profiles[idx].faceEmbedding = embedding;
        saveProfiles(profiles);
      }
    }
    // reload to get the updated profile with embedding
    const updatedProfile = getProfileById(profile.id);
    res.json({ ok: true, profile: updatedProfile });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown error' });
  }
});

app.post('/api/visits/capture', async (req, res) => {
  const { visitorId, transcript, faceMatch } = req.body;

  if (!visitorId || !transcript) {
    return res.status(400).json({ error: 'visitorId and transcript are required' });
  }

  const memory = await extractVisitMemory({ visitorId, transcript, faceMatch });
  const saved = saveVisit({ visitorId, memory });

  res.json({ ok: true, visit: saved });
});

app.post('/api/videodb/upload-url', async (req, res) => {
  try {
    const { visitorId, filename } = req.body;
    if (!visitorId) return res.status(400).json({ error: 'visitorId is required' });

    const profile = getProfileById(visitorId);
    if (!profile) return res.status(404).json({ error: 'profile not found' });

    const collectionId = await ensureVideoDbCollection(profile);
    const safeFilename = filename || `${cleanName(profile.name)}-${Date.now()}.webm`;
    const uploadResponse = await axios.get(
      `${videoDbApiUrl}/collection/${collectionId}/upload_url`,
      {
        params: { name: safeFilename },
        headers: { 'x-access-token': requireVideoDbKey() },
      }
    );

    const data = uploadResponse.data?.data;
    if (!data?.upload_url || !data?.video_id) {
      return res.status(502).json({ error: 'VideoDB did not return an upload URL' });
    }

    res.json({
      ok: true,
      collectionId,
      collectionName: `MemoryBridge - ${profile.name}`,
      uploadUrl: data.upload_url,
      videoId: data.video_id,
      filename: safeFilename,
    });
  } catch (err) {
    const status = err.statusCode || err.response?.status || 500;
    res.status(status).json({
      error: err.response?.data?.message || err.message || 'Unable to create VideoDB upload URL',
    });
  }
});

app.post('/api/interaction-reports', async (req, res) => {
  try {
    const { visitorId, faceMatch, video } = req.body;
    if (!visitorId) return res.status(400).json({ error: 'visitorId is required' });
    if (!video?.videoId) return res.status(400).json({ error: 'video.videoId is required' });

    const profile = getProfileById(visitorId) || faceMatch;
    const timestamp = new Date().toISOString();
    const memory = {
      visitorId,
      transcript: '',
      faceMatch: profile,
      summary: `Live interaction recording captured for ${profile?.name || 'visitor'}.`,
      surfaceText: `A new interaction recording is saved for ${profile?.name || 'this visitor'}.`,
      notes: `VideoDB recording captured at ${timestamp}`,
      timestamp,
    };

    const saved = saveVisit({
      visitorId,
      memory,
      reportType: 'interaction-recording',
      video: {
        provider: 'videodb',
        videoId: video.videoId,
        collectionId: video.collectionId,
        collectionName: video.collectionName,
        filename: video.filename,
        uploadedAt: timestamp,
        status: 'uploaded',
      },
    });

    res.json({ ok: true, report: saved });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to save report' });
  }
});

app.get('/api/visits', (req, res) => {
  const visits = listVisits();
  res.json({ visits });
});

app.get('/api/visits/last/:visitorId', async (req, res) => {
  const visitorId = req.params.visitorId;
  const last = getLastVisitForVisitor(visitorId);
  res.json({ visitorId, lastVisit: last });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`MemoryBridge backend listening on http://localhost:${port}`);
});
