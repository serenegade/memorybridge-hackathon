// Migrate embeddings: compute and persist embeddings for profiles without them
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { loadProfiles, saveProfiles, computeEmbeddingFromDataUrl } = require('./agents/profiles');

const facesDir = path.join(__dirname, '../data/faces');

(async () => {
  console.log('Loading profiles...');
  const profiles = loadProfiles();
  console.log(`Found ${profiles.length} profiles`);

  let updated = 0;
  for (const profile of profiles) {
    if (profile.faceEmbedding) {
      console.log(`⊘ ${profile.id}: already has embedding`);
      continue;
    }
    if (!profile.faceImage) {
      console.log(`⊘ ${profile.id}: no faceImage, skipping`);
      continue;
    }

    const imagePath = path.join(__dirname, '../data', profile.faceImage);
    if (!fs.existsSync(imagePath)) {
      console.log(`⊘ ${profile.id}: face file not found at ${imagePath}`);
      continue;
    }

    try {
      const buf = fs.readFileSync(imagePath);
      const b64 = buf.toString('base64');
      const ext = profile.faceImage.includes('.png') ? 'png' : 'jpg';
      const dataUrl = `data:image/${ext};base64,${b64}`;
      const embedding = await computeEmbeddingFromDataUrl(dataUrl);
      if (embedding && Array.isArray(embedding)) {
        profile.faceEmbedding = embedding;
        updated++;
        console.log(`✓ ${profile.id}: computed embedding (${embedding.length} dims)`);
      } else {
        console.log(`✗ ${profile.id}: failed to compute embedding`);
      }
    } catch (err) {
      console.log(`✗ ${profile.id}: error - ${err.message}`);
    }
  }

  console.log(`\nSaving ${updated} updated profiles...`);
  saveProfiles(profiles);
  console.log('Done!');
})();
