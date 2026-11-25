export function suggestFromInteractionNotes(notes, today) {
  const text = notes.trim();
  const lower = text.toLowerCase();
  const ministryMatches = [
    ['mentoring', 'Mentoring'],
    ['barton bag', 'Barton Bags'],
    ['care communit', 'Care Communities'],
    ['foster', 'Foster care'],
    ['adopt', 'Adoption support'],
    ['giving', 'Financial giving'],
  ].filter(([needle]) => lower.includes(needle)).map(([, label]) => label);

  let followUpDate = null;
  const weekday = lower.match(/\b(?:next|on) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday || /tomorrow|next week|follow.?up|call (?:back|again)|reach back|circle back|will email|schedule|set up|send (?:her|him|them|over)/.test(lower)) {
    const date = new Date(`${today}T12:00:00Z`);
    const days = weekday ? ((['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekday[1]) - date.getUTCDay() + 7) % 7 || 7) : /tomorrow/.test(lower) ? 1 : 7;
    date.setUTCDate(date.getUTCDate() + days);
    followUpDate = date.toISOString().slice(0, 10);
  }

  const stage = /partner|ready to move forward|committed/.test(lower)
    ? 'partnering'
    : /interested|would like|wants? (more|info)|follow.?up/.test(lower)
      ? 'potential'
      : null;

  return {
    summary: text.replace(/\s+/g, ' ').replace(/^./, char => char.toUpperCase()),
    ministryTags: ministryMatches,
    suggestedStage: stage,
    followUp: followUpDate ? { title: 'Follow up on recent conversation', dueDate: followUpDate } : null,
  };
}
