/**
 * Settings for the live discussion grades app.
 *
 * This is the one file you edit. Updates to the app replace Code.gs and Index.html,
 * never this file, so your settings stay as you set them.
 */

// ===================================================================== YOUR COURSE
// Set these before you deploy. After changing them on a live app: save, then
// Deploy → Manage deployments → ✏️ → Version: New version → Deploy. The TA link stays the same.
var COURSE = {
  name: 'Course 101',                                   // shown at the top of the app, e.g. 'EMA 303'
  sections: ['DIS301', 'DIS302', 'DIS303', 'DIS304'],   // your discussion sections, as the app should show them
  classDays: ['Wed', 'Fri'],                            // the weekdays they meet: 'Mon' 'Tue' 'Wed' 'Thu' 'Fri'
  firstDay: '2026-09-02',                               // the first class day of the semester (year-month-day)
  lastDay: '2026-12-11',                                // the last class day
  maxGrade: 10,                                         // grades run from 0 to this
  defaultGrade: 10,                                     // what tapping an empty box fills in
  // Coming late: [up to this many minutes late, the most they can get], so 1–5 min -> 9, 6–10 -> 8, ...
  // The last step means that late or later (26+).
  lateSteps: [[5, 9], [10, 8], [15, 7], [20, 6], [25, 5], [26, 4]]
};
// ==================================================================================

// Optional. Your Canvas assignments, written the way a Canvas gradebook export names its columns,
// e.g. 'Discussion 1 (1234567)': the number in parentheses is the assignment's Canvas ID.
// These seed the pick list on the "Canvas assignments" tab. You can leave this empty and paste
// the names into column E of that tab instead.
var CANVAS_DAS = [];

// Optional. Which assignment each class day's grades go into, e.g. {'Fri 9/11': 'Discussion 1 (1234567)'}.
// Only used to fill in the "Canvas assignments" tab when it's first created; after that, the tab rules.
var DA_SCHEDULE = {};
// Optional. A note to show beside a class day on that tab, e.g. {'Wed 11/25': 'No class'}.
var DA_NOTES = {};
