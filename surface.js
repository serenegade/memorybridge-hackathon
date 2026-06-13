function createSurfaceText({ visitorName, relationship, lastVisit }) {
  return `This is ${visitorName}, your ${relationship}. ${lastVisit ? `They visited ${lastVisit}.` : 'This is the first visit I have on file.'}`;
}

module.exports = { createSurfaceText };
