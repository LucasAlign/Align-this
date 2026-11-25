// Display labels and badge variants for every enum in the schema.
// Variants map to the badge color system: green | blue | amber | red | purple | gray

// Current engagement taxonomy. Legacy keys (active_partner, strategic_partner,
// interested, initial_contact, not_contacted, dormant) are kept as aliases so
// any un-migrated rows from Supabase still render a correct badge; the
// migration in helpers.js rewrites them to the new keys at load time.
export const ENGAGEMENT_STATUS = {
  partnering:     { label: 'Partnering', variant: 'green' },
  potential:      { label: 'Potential', variant: 'amber' },
  unreached:      { label: 'Unreached', variant: 'gray' },
  unable_to_sign: { label: 'Unable to sign partnership', variant: 'red' },
  // legacy aliases (pre-migration safety) — same display as their new target
  active_partner:    { label: 'Partnering', variant: 'green' },
  strategic_partner: { label: 'Potential', variant: 'amber' },
  interested:        { label: 'Potential', variant: 'amber' },
  initial_contact:   { label: 'Potential', variant: 'amber' },
  not_contacted:     { label: 'Unreached', variant: 'gray' },
  dormant:           { label: 'Unreached', variant: 'gray' },
};

// New statuses in display order + a ready-made filter list (with leading "All").
export const ENGAGEMENT_STATUS_ORDER = ['partnering', 'potential', 'unreached', 'unable_to_sign'];
export const ENGAGEMENT_STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  ...ENGAGEMENT_STATUS_ORDER.map(value => ({ value, label: ENGAGEMENT_STATUS[value].label })),
];

export const INTERACTION_TYPE = {
  email: { label: 'Email', variant: 'blue' },
  phone_call: { label: 'Phone call', variant: 'blue' },
  meeting: { label: 'Meeting', variant: 'green' },
  lunch: { label: 'Lunch', variant: 'green' },
  event_invitation: { label: 'Event invitation', variant: 'amber' },
  presentation: { label: 'Presentation', variant: 'purple' },
  stand_sunday: { label: 'Stand Sunday discussion', variant: 'purple' },
  care_community_meeting: { label: 'Care Community meeting', variant: 'green' },
  volunteer_recruitment: { label: 'Volunteer recruitment', variant: 'amber' },
  training: { label: 'Training', variant: 'amber' },
  follow_up: { label: 'Follow-up', variant: 'gray' },
  giving_conversation: { label: 'Giving conversation', variant: 'purple' },
  impact_report: { label: 'Impact Report', variant: 'purple' },
};

export const TASK_PRIORITY = {
  low: { label: 'Low', variant: 'gray' },
  medium: { label: 'Medium', variant: 'blue' },
  high: { label: 'High', variant: 'amber' },
  critical: { label: 'Critical', variant: 'red' },
};

export const TASK_STATUS = {
  open: { label: 'Open', variant: 'blue' },
  in_progress: { label: 'In progress', variant: 'amber' },
  waiting: { label: 'Waiting', variant: 'gray' },
  overdue: { label: 'Overdue', variant: 'red' },
  completed: { label: 'Completed', variant: 'green' },
};
