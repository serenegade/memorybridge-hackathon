const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const profilesFile = path.join(__dirname, '../../data/profiles.json');
const facesDir = path.join(__dirname, '../../data/faces');

if (!fs.existsSync(facesDir)) {
  fs.mkdirSync(facesDir, { recursive: true });
}

function loadProfiles() {
  try {
    const raw = fs.readFileSync(profilesFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function saveProfiles(profiles) {
  fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2), 'utf8');
}

function saveFaceImage(id, dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const parts = dataUrl.split(',');
  if (parts.length !== 2) return null;
  const meta = parts[0];
  const b64 = parts[1];
  const ext = meta.includes('image/png') ? 'png' : 'jpg';
  const filename = `${id}.${ext}`;
  const filepath = path.join(facesDir, filename);
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(filepath, buf);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  return { filename, filepath, hash };
}

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function addProfile({ name, relationship, notes, faceData, facePHash }) {
  const profiles = loadProfiles();
  const id = slugify(name || `visitor-${Date.now()}`);
  let faceImage = null;
  let faceHash = null;
  let faceEmbedding = null;
  if (faceData) {
    const saved = saveFaceImage(id, faceData);
    if (saved) {
      faceImage = `faces/${saved.filename}`;
      faceHash = saved.hash;
    }
  }
  const faceP = facePHash || null;

  const profile = {
    id,
    name,
    relationship,
    bio: notes || '',
    faceModel: faceImage ? 'data' : 'demo',
    faceImage: faceImage,
    faceHash: faceHash,
    faceEmbedding: faceEmbedding,
    facePHash: faceP,
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  saveProfiles(profiles);
  return profile;
}

// Compute a simple local embedding from a data URL using sharp (32x32 grayscale -> 32-dim vector)
async function computeEmbeddingFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  try {
    const sharp = require('sharp');
    const parts = dataUrl.split(',');
    if (parts.length !== 2) return null;
    const buf = Buffer.from(parts[1], 'base64');
    const raw = await sharp(buf).resize(32, 32).grayscale().raw().toBuffer();
    const vals = Array.from(raw).map((v) => v / 255);
    // collapse rows to a 32-dim vector by averaging each row
    const dim = 32;
    const vec = new Array(dim).fill(0);
    for (let r = 0; r < dim; r++) {
      let sum = 0;
      for (let c = 0; c < dim; c++) {
        sum += vals[r * dim + c];
      }
      vec[r] = sum / dim;
    }
    // normalize (L2)
    const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
    return vec.map((v) => v / norm);
  } catch (err) {
    return null;
  }
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}

function findProfileByEmbedding(embedding, minSimilarity = 0.82) {
  if (!embedding) return null;
  const profiles = loadProfiles();
  let best = null;
  let bestScore = -Infinity;
  for (const p of profiles) {
    if (!p.faceEmbedding) continue;
    const score = cosineSimilarity(embedding, p.faceEmbedding);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  if (bestScore >= minSimilarity) return best;
  return null;
}

function getProfileById(id) {
  const profiles = loadProfiles();
  return profiles.find((profile) => profile.id === id) || null;
}

function getRecognisedVisitor() {
  const profiles = loadProfiles();
  return profiles.length > 0 ? profiles[0] : null;
}

function findProfileByHash(hash) {
  if (!hash) return null;
  const profiles = loadProfiles();
  return profiles.find((p) => p.faceHash === hash) || null;
}

function hammingDistanceHex(a, b) {
  if (!a || !b) return Infinity;
  // convert hex to binary strings
  const ba = BigInt('0x' + a);
  const bb = BigInt('0x' + b);
  let x = ba ^ bb;
  let dist = 0;
  while (x) {
    dist += Number(x & 1n);
    x = x >> 1n;
  }
  return dist;
}

function findProfileByPHash(phash, maxDistance = 10) {
  if (!phash) return null;
  const profiles = loadProfiles();
  let best = null;
  let bestDist = Infinity;
  for (const p of profiles) {
    const candidate = p.facePHash;
    if (!candidate) continue;
    const dist = hammingDistanceHex(phash, candidate);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  if (bestDist <= maxDistance) return best;
  return null;
}

module.exports = {
  loadProfiles,
  saveProfiles,
  addProfile,
  getProfileById,
  getRecognisedVisitor,
  findProfileByHash,
  findProfileByPHash,
  computeEmbeddingFromDataUrl,
  findProfileByEmbedding,
};
