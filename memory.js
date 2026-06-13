const fs = require('fs');
const path = require('path');

const visitsFile = path.join(__dirname, '../../data/visits.json');

function loadVisits() {
  try {
    const raw = fs.readFileSync(visitsFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function saveVisits(visits) {
  fs.writeFileSync(visitsFile, JSON.stringify(visits, null, 2), 'utf8');
}

function saveVisit({ visitorId, memory, video = null, reportType = 'visit' }) {
  const visits = loadVisits();
  const record = {
    id: `${visitorId}-${Date.now()}`,
    visitorId,
    memory,
    video,
    reportType,
    createdAt: new Date().toISOString(),
  };
  visits.unshift(record);
  saveVisits(visits);
  return record;
}

function listVisits() {
  return loadVisits();
}

function getLastVisitForVisitor(visitorId) {
  const visits = loadVisits();
  return visits.find((visit) => visit.visitorId === visitorId) || null;
}

module.exports = { saveVisit, getLastVisitForVisitor, listVisits };
