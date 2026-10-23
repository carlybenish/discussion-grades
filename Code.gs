/**
 * Live discussion grades
 *
 * A web app backed by this spreadsheet. TAs enter grades in the app; each
 * class day gets its own tab (e.g. "Fri 9/11") listing every student in every
 * section. A day's tab is created the first time anyone enters a grade
 * for that day. Every change is also appended to the "Change log" tab, so a
 * grade that gets overwritten can always be recovered.
 *
 * The student list comes from the "Roster" tab (Section, Table, Group,
 * Student, plus Canvas ID columns). Roster → Update from Canvas builds and
 * updates it from a Canvas gradebook export; you can also edit it by hand.
 * The app picks up a change within a minute.
 *
 * The spreadsheet's Canvas menu turns any class-day tab into a file for
 * Canvas's Grades → Import. Each time it does, the "Export log" tab gets a
 * row saying who made the file, when, and for which day.
 *
 * Your course's settings are in Settings.gs. Updates replace this file and
 * Index.html but never Settings.gs, so the settings stay put.
 */
var ROSTER_TAB = 'Roster';
var LOG_TAB = 'Change log';
var CANVAS_TAB = 'Canvas import';
var HAND_TAB = 'Enter by hand';
var HAND_HEADER = ['Class day', 'Section', 'Table', 'Student', 'Grade', 'Entered in Canvas'];
var ASSIGN_TAB = 'Canvas assignments';
var EXPORT_LOG_TAB = 'Export log';
var EXPORT_LOG_HEADER = ['When', 'Who', 'Class day', 'Canvas assignment', 'Grades in file', 'Enter by hand', 'No grade (left out)'];
var DAY_HEADER = ['Section', 'Table', 'Group', 'Student', 'Grade', 'Entered by', 'Updated', 'Late', 'Late changed',
                  'Minutes late'];
var LATE_MARK = 'Late';
var TA_TAB = 'TA Schedule';
var ACCESS_TAB = 'TA access';
var ACCESS_HEADER = ['Email', 'Who', 'Note'];
var ACCESS_LOG_TAB = 'Access log';
var ACCESS_LOG_HEADER = ['When', 'Email', 'What happened'];
var LOG_HEADER = ['When', 'Class day', 'Section', 'Student', 'Old grade', 'New grade', 'Entered by'];
var DAY_CACHE_SECONDS = 20;    // edits made directly in the sheet reach the app within this long
var ROSTER_CACHE_SECONDS = 60;
var ACCESS_CACHE_SECONDS = 60; // a change to the TA access tab takes effect within this long
var DENY_QUIET_SECONDS = 600;  // one person's blocked tries are logged at most this often
var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function doGet() {
  var problem = courseProblem_();
  if (problem) {
    return HtmlService.createHtmlOutput('<p style="font:16px/1.5 sans-serif;max-width:34em;margin:40px auto">' +
      '<b>The course settings (Settings.gs) need fixing.</b><br>' + escapeHtml_(problem) + '</p>')
      .setTitle('Grades: setup problem');
  }
  var email = normEmail_(currentEmail_());
  if (!email || !allowedEmails_()[email]) {
    logDenied_(email);
    return denyPage_(email);
  }
  var page = HtmlService.createTemplateFromFile('Index');
  page.courseName = COURSE.name;
  page.courseJson = courseJson_();
  return page.evaluate()
    .setTitle(COURSE.name + ' Grades')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** The COURSE block for the page. Written into a <script>, so nothing in it can close the tag. */
function courseJson_() {
  return JSON.stringify({
    sections: COURSE.sections,
    classDays: COURSE.classDays,
    firstDay: COURSE.firstDay,
    lastDay: COURSE.lastDay,
    maxGrade: COURSE.maxGrade,
    defaultGrade: COURSE.defaultGrade,
    lateSteps: COURSE.lateSteps,
    storageKey: String(COURSE.name).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'grades'
  }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** What's wrong with the COURSE block in Settings.gs, in words, or '' if nothing is. */
function courseProblem_() {
  if (typeof COURSE === 'undefined') {
    return 'There\'s no course settings file. In Apps Script, add a script file named Settings and paste ' +
      'Settings.gs from the kit into it.';
  }
  var c = COURSE;
  var isDate = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(utcDay_(s)); };
  if (!c || !String(c.name || '').trim()) return 'name is empty. Put the course name in quotes, e.g. \'EMA 303\'.';
  if (!Array.isArray(c.sections) || !c.sections.length) return 'sections needs at least one section, e.g. [\'DIS301\'].';
  for (var i = 0; i < c.sections.length; i++) {
    if (!/^[A-Za-z0-9 ]{1,12}$/.test(String(c.sections[i])) || !String(c.sections[i]).trim()) {
      return 'sections: "' + c.sections[i] + '" should be short letters and numbers, like DIS301.';
    }
    if (c.sections.indexOf(c.sections[i]) !== i) return 'sections lists ' + c.sections[i] + ' twice.';
  }
  if (!Array.isArray(c.classDays) || !c.classDays.length) return 'classDays needs at least one weekday, e.g. [\'Wed\'].';
  for (i = 0; i < c.classDays.length; i++) {
    if (WEEKDAYS.indexOf(c.classDays[i]) < 0) {
      return 'classDays: "' + c.classDays[i] + '" isn\'t one of ' + WEEKDAYS.join(', ') + ' (three letters, capital first).';
    }
  }
  if (!isDate(c.firstDay)) return 'firstDay should look like \'2027-01-20\' (year-month-day, in quotes).';
  if (!isDate(c.lastDay)) return 'lastDay should look like \'2027-05-07\' (year-month-day, in quotes).';
  if (utcDay_(c.lastDay) < utcDay_(c.firstDay)) return 'lastDay is before firstDay.';
  if (!classDays_().length) return 'No ' + c.classDays.join(' or ') + ' falls between firstDay and lastDay.';
  if (!(c.maxGrade > 0 && c.maxGrade < 100)) return 'maxGrade should be a number from 1 to 99.';
  if (!(c.defaultGrade >= 0 && c.defaultGrade <= c.maxGrade)) return 'defaultGrade should be from 0 to maxGrade.';
  if (!Array.isArray(c.lateSteps) || !c.lateSteps.length) return 'lateSteps needs at least one step, e.g. [[5, 8]].';
  for (i = 0; i < c.lateSteps.length; i++) {
    var s = c.lateSteps[i];
    if (!Array.isArray(s) || s.length !== 2 || !(s[0] > 0) || Math.floor(s[0]) !== s[0] ||
        !(s[1] >= 0 && s[1] <= c.maxGrade)) {
      return 'lateSteps: each step is [minutes, most they can get], e.g. [10, 7], with the grade from 0 to maxGrade.';
    }
    if (i && s[0] <= c.lateSteps[i - 1][0]) return 'lateSteps: list the minutes from smallest to largest.';
  }
  return '';
}

/** "2026-09-02" -> that day at midnight UTC, in ms. */
function utcDay_(s) {
  var p = String(s).split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

/** The Late button's choices, in minutes; the last means that late or later. */
function lateChoices_() {
  return COURSE.lateSteps.map(function (s) { return s[0]; });
}

/** Everything the app needs on first load. */
function init() {
  requireTa_();
  return {
    roster: rosterData_(),
    tas: taScheduleData_(),
    me: currentEmail_(),
    sheetUrl: SpreadsheetApp.getActive().getUrl()
  };
}

/** {DIS301: [[name, table, group], ...], ...} in Roster-tab order. */
function getRoster() {
  requireTa_();
  return rosterData_();
}

function rosterData_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('roster');
  if (hit) return JSON.parse(hit);

  var sheet = SpreadsheetApp.getActive().getSheetByName(ROSTER_TAB);
  if (!sheet) throw new Error('The spreadsheet has no "Roster" tab.');
  var values = sheet.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {
    section: header.indexOf('section'),
    table: header.indexOf('table'),
    group: header.indexOf('group'),
    student: header.indexOf('student')
  };
  if (col.section < 0 || col.student < 0) {
    throw new Error('The Roster tab needs "Section" and "Student" columns in row 1.');
  }

  var roster = {};
  COURSE.sections.forEach(function (s) { roster[s] = []; });
  for (var i = 1; i < values.length; i++) {
    var section = normSection_(values[i][col.section]);
    var name = String(values[i][col.student]).trim();
    if (!section || !name) continue;
    roster[section].push([
      name,
      col.table < 0 ? '' : tableValue_(values[i][col.table]),
      col.group < 0 ? '' : String(values[i][col.group]).trim().toUpperCase()
    ]);
  }
  cache.put('roster', JSON.stringify(roster), ROSTER_CACHE_SECONDS);
  return roster;
}

/**
 * Grades for one class day:
 * {"DIS301|Name": [grade, enteredBy, updatedMs, table, group, late, lateChangedMs, minutesLate]}.
 * Pass back the version from the previous call; if nothing changed, only {v} comes back.
 */
function getDay(date, knownVersion) {
  requireTa_();
  checkDate_(date);
  var state = dayState_(date);
  if (knownVersion && knownVersion === state.v) return { v: state.v };
  return { v: state.v, grades: JSON.parse(state.d) };
}

/** Save one grade. p = {date, section, student, grade, table, group, by}; grade '' clears it. */
function saveGrade(p) {
  requireTa_();
  checkDate_(p.date);
  var section = checkSection_(p.section);
  var student = checkStudent_(p.student);
  var grade = parseGrade_(p.grade);
  var who = currentEmail_() || String(p.by || '').trim().slice(0, 60);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActive();
    var sheet = dayTab_(ss, p.date);
    var at = findRow_(sheet, section, student, p);
    var now = new Date();
    sheet.getRange(at.row, 5, 1, 3).setValues([[grade, safeText_(who), now]]);
    logChange_(ss, now, p.date, section, student, gradeValue_(at.values[4]), grade, who);
    SpreadsheetApp.flush();
    updateDayCache_(p.date, section + '|' + student,
      [grade, who, now.getTime(), at.table, at.group, isLate_(at.values[7]), timeValue_(at.values[8]),
       lateMinutes_(at.values[9])]);
    return { grade: grade, by: who, t: now.getTime() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Flag (or unflag) a student as late for a class day, with or without a grade.
 * p = {date, section, student, late, minutes, table, group, by}. The flag shows in the day tab's Late column,
 * and how late (1–5, 6–10, 11–15, 16–20, 21–25 or 26+) in its Minutes late column.
 */
function setLate(p) {
  requireTa_();
  checkDate_(p.date);
  var section = checkSection_(p.section);
  var student = checkStudent_(p.student);
  var late = p.late === true;
  var minutes = late ? lateMinutes_(p.minutes) : '';
  var who = currentEmail_() || String(p.by || '').trim().slice(0, 60);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActive();
    var sheet = dayTab_(ss, p.date);
    ensureLateColumns_(sheet);
    var at = findRow_(sheet, section, student, p);
    var before = lateText_(isLate_(at.values[7]), lateMinutes_(at.values[9]));
    var after = lateText_(late, minutes);
    var now = new Date();
    // The time is kept even when the flag is cleared, so the newest change always wins in the app.
    sheet.getRange(at.row, 10).setNumberFormat('@');    // plain text, so "1–5" can't turn into a date
    sheet.getRange(at.row, 8, 1, 3).setValues([[late ? LATE_MARK : '', now, minutesCell_(minutes)]]);
    if (before !== after) logChange_(ss, now, p.date, section, student, before, after, who);
    SpreadsheetApp.flush();
    updateDayCache_(p.date, section + '|' + student,
      [gradeValue_(at.values[4]), String(at.values[5] || ''), timeValue_(at.values[6]), at.table, at.group,
       late, now.getTime(), minutes]);
    return { late: late, minutes: minutes, t: now.getTime() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Who covers what on each class day:
 * {"Wed|DIS301": {blocks: [[1, 4, "Rivera"], ...], lead: "Okafor", support: "Lindgren"}}.
 * Comes from the Roster tab's "TA" column, or "Wed TA", "Fri TA", "Wed Lead", ... columns, so it updates with the
 * roster import. A "TA Schedule" tab (workbook layout) is used only if the Roster tab has no TA columns.
 * Display only: nothing in the spreadsheet depends on it.
 */
function getTaSchedule() {
  requireTa_();
  return taScheduleData_();
}

function taScheduleData_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('tas');
  if (hit) return JSON.parse(hit);
  var out = tasFromRoster_() || tasFromTab_();
  cache.put('tas', JSON.stringify(out), ROSTER_CACHE_SECONDS);
  return out;
}

function tasFromRoster_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(ROSTER_TAB);
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var sectionCol = header.indexOf('section');
  var tableCol = header.indexOf('table');
  // A "Wed TA" column covers Wednesdays; a plain "TA" column covers every class day without its own.
  var colFor = function (day, role) {
    var c = header.indexOf(day.toLowerCase() + ' ' + role);
    return c >= 0 ? c : header.indexOf(role);
  };
  if (!COURSE.classDays.some(function (day) { return colFor(day, 'ta') >= 0; })) return null;
  var out = {};
  COURSE.classDays.forEach(function (day) {
    var taCol = colFor(day, 'ta');
    var leadCol = colFor(day, 'lead');
    var supportCol = colFor(day, 'support');
    if (taCol < 0) return;
    var bySection = {};
    for (var i = 1; i < values.length; i++) {
      var section = normSection_(values[i][sectionCol]);
      var table = Number(values[i][tableCol]);
      if (!section || !table) continue;
      var slot = bySection[section] = bySection[section] || { tables: {}, lead: '', support: '' };
      var ta = String(values[i][taCol]).trim();
      if (ta) slot.tables[table] = ta;
      if (leadCol >= 0 && !slot.lead) slot.lead = String(values[i][leadCol]).trim();
      if (supportCol >= 0 && !slot.support) slot.support = String(values[i][supportCol]).trim();
    }
    Object.keys(bySection).forEach(function (section) {
      var slot = bySection[section];
      var blocks = [];    // runs of consecutive tables with the same TA
      Object.keys(slot.tables).map(Number).sort(function (a, b) { return a - b; }).forEach(function (t) {
        var run = blocks[blocks.length - 1];
        if (run && run[2] === slot.tables[t]) run[1] = t;
        else blocks.push([t, t, slot.tables[t]]);
      });
      out[day + '|' + section] = { blocks: blocks, lead: slot.lead, support: slot.support };
    });
  });
  return out;
}

/**
 * Fallback: a "TA Schedule" tab laid out like the workbook's. Row 1 holds TA names from column C on;
 * each following row starts with a class weekday (Wed, Fri, ...), names the section in column B, and a TA's cell reads
 * "1 to 4" (a table block), "Lead", or "Support".
 */
function tasFromTab_() {
  var out = {};
  var sheet = SpreadsheetApp.getActive().getSheetByName(TA_TAB);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var values = sheet.getDataRange().getValues();
  var tas = values[0].map(function (v) { return String(v).trim(); });
  for (var i = 1; i < values.length; i++) {
    var day = String(values[i][0]).trim().match(new RegExp('^(' + COURSE.classDays.join('|') + ')\\b'));
    var section = normSection_(values[i][1]);
    if (!day || !section) continue;
    var slot = { blocks: [], lead: '', support: '' };
    for (var j = 2; j < values[i].length; j++) {
      var role = String(values[i][j]).trim();
      if (!role || !tas[j]) continue;
      var block = role.match(/^(\d+)\s*(?:to|-|–)\s*(\d+)$/i);
      if (block) slot.blocks.push([Number(block[1]), Number(block[2]), tas[j]]);
      else if (/^lead$/i.test(role)) slot.lead = tas[j];
      else if (/^support$/i.test(role)) slot.support = tas[j];
    }
    slot.blocks.sort(function (a, b) { return a[0] - b[0]; });
    out[day[1] + '|' + section] = slot;
  }
  return out;
}

// ---------------------------------------------------------------- Canvas

// CANVAS_DAS, DA_SCHEDULE and DA_NOTES (all optional) are in Settings.gs.

/** Adds the Roster, Canvas and TA access menus to the spreadsheet (visible to editors, e.g. the head TA). */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Roster')
    .addItem('Update from Canvas…', 'showRosterImport')
    .addToUi();
  ui.createMenu('Canvas')
    .addItem('Make Canvas import from this day', 'makeCanvasImport')
    .addItem('Show Canvas assignment list', 'showAssignments')
    .addItem('Export log', 'showExportLog')
    .addToUi();
  ui.createMenu('TA access')
    .addItem('Who can open the app', 'showAccess')
    .addItem('Add the TAs from the roster', 'addTasFromRoster')
    .addItem('Blocked sign-ins', 'showAccessLog')
    .addToUi();
}

/* ------------------------------------------------------------------ *
 * Roster from Canvas (kit only; build_kit.py puts this into Code.gs)
 *
 * Roster → Update from Canvas reads a Canvas gradebook export just as it downloads and builds or
 * updates the Roster tab from it. It shows what it will change before changing anything.
 * - Students are matched by Canvas ID, so Table, Group, TA and any other columns stay as they are.
 *   Rows typed in by hand (no Canvas ID yet) are matched by name and get their IDs filled in.
 * - New students go in name order within their section, highlighted yellow.
 * - A student who changed sections moves to the new one, highlighted so their table can be checked.
 * - Students who aren't in the file are listed, and removed only if the box is ticked.
 * - A name that changed in Canvas is listed but left alone: each class day's tab keeps the names
 *   it was made with, so renaming here would unlink those days from the student's Canvas IDs.
 * - Two new students with one name in one section get their login added, e.g. "Lee, Sam (slee4)",
 *   since the app tells students apart by section and name.
 * ------------------------------------------------------------------ */

var ROSTER_NEW_HEADER = ['Section', 'Table', 'Group', 'Student', 'Canvas ID', 'SIS User ID', 'SIS Login ID',
                         'Canvas section'];
var ROSTER_ID_HEADERS = ['Canvas ID', 'SIS User ID', 'SIS Login ID', 'Canvas section'];
var ROSTER_FLAG_COLOR = '#fff2a8';   // new students and section changes
var ROSTER_ONE_BY_ONE = 25;          // more additions than this go in at the bottom in one go, still in order

/** Opens the "Update the roster from Canvas" window. */
function showRosterImport() {
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(ROSTER_DIALOG_HTML).setWidth(620).setHeight(580),
    'Update the roster from Canvas');
}

/** What updating the Roster tab from this Canvas export would change. Changes nothing. */
function previewCanvasRoster(csvText) {
  requireEditor_();
  return rosterPlan_(SpreadsheetApp.getActive(), csvText).summary;
}

/** Makes the changes previewCanvasRoster listed. removeGone: also delete the students who aren't in the file. */
function applyCanvasRoster(csvText, removeGone) {
  requireEditor_();
  var ss = SpreadsheetApp.getActive();
  var plan = rosterPlan_(ss, csvText);
  if (plan.summary.noMatch) {
    throw new Error('None of the students in that file are on the Roster tab, so nothing was changed.');
  }
  plan.summary.removed = writeRosterPlan_(ss, plan, removeGone === true);
  CacheService.getScriptCache().removeAll(['roster', 'tas']);
  return plan.summary;
}

/**
 * Throws unless the caller can edit this spreadsheet. The Roster window's functions can also be
 * reached through the web app, where they'd run as the owner, so they check who's asking.
 */
function requireEditor_() {
  var email = normEmail_(currentEmail_());
  if (email && email === normEmail_(ownerEmail_())) return;
  var editors = SpreadsheetApp.getActive().getEditors().map(function (u) { return normEmail_(u.getEmail()); });
  if (email && editors.indexOf(email) >= 0) return;
  throw new Error('Only people who can edit this spreadsheet can change the roster.');
}

/**
 * Lines a Canvas export up with the Roster tab. Returns {summary} for the window, plus what
 * writeRosterPlan_ needs: the tab, its header (with any ID columns it was missing), its rows with
 * their updates applied in memory, and the students to add.
 */
function rosterPlan_(ss, csvText) {
  var file = readCanvasExport_(csvText);
  var sheet = ss.getSheetByName(ROSTER_TAB);
  var values = sheet ? sheet.getDataRange().getValues() : [];
  var hasContent = values.some(function (row) { return row.some(function (v) { return String(v).trim() !== ''; }); });
  var hadHeader = hasContent;
  var header = hadHeader ? values[0].map(function (h) { return String(h).trim(); }) : ROSTER_NEW_HEADER.slice();
  var lower = header.map(function (h) { return h.toLowerCase(); });
  if (lower.indexOf('section') < 0 || lower.indexOf('student') < 0) {
    throw new Error('Row 1 of the Roster tab needs "Section" and "Student" columns. To start a fresh roster ' +
      'instead, rename that tab (say, to "Old roster") and run this again.');
  }
  var addColumns = ROSTER_ID_HEADERS.filter(function (h) { return lower.indexOf(h.toLowerCase()) < 0; });
  header = header.concat(addColumns);
  lower = header.map(function (h) { return h.toLowerCase(); });
  var col = {
    section: lower.indexOf('section'),
    student: lower.indexOf('student'),
    id: lower.indexOf('canvas id'),
    sis: lower.indexOf('sis user id'),
    login: lower.indexOf('sis login id'),
    canvasSection: lower.indexOf('canvas section')
  };
  var width = header.length;
  var text = function (v) { return String(v === null || v === undefined ? '' : v).trim(); };

  var rows = (hadHeader ? values.slice(1) : []).map(function (v, i) {
    var cells = v.slice();
    while (cells.length < width) cells.push('');
    return { at: i, cells: cells, blank: cells.every(function (c) { return text(c) === ''; }) };
  });
  var filled = rows.filter(function (r) { return !r.blank; });

  // Match by Canvas ID, then rows with no ID by name (only when one student in the file has that name).
  var inFile = {};
  file.students.forEach(function (s) { inFile[s.id] = s; });
  var taken = {};
  filled.forEach(function (r) {
    var id = text(r.cells[col.id]);
    if (id && inFile[id] && !taken[id]) { r.match = inFile[id]; taken[id] = true; }
  });
  var byName = Object.create(null);
  file.students.forEach(function (s) {
    if (taken[s.id]) return;
    var k = nameKey_(s.name);
    byName[k] = k in byName ? null : s;
  });
  filled.forEach(function (r) {
    if (r.match || text(r.cells[col.id])) return;
    var s = byName[baseName_(r.cells[col.student])];
    if (s && !taken[s.id]) { r.match = s; taken[s.id] = true; }
  });

  var summary = {
    inFile: file.students.length, skipped: file.skipped, created: !filled.length,
    added: [], moved: [], gone: [], renamed: [], madeUnique: [], sameName: [], outside: [],
    refreshed: 0, unchanged: 0, noMatch: filled.length > 0 && !filled.some(function (r) { return r.match; })
  };

  filled.forEach(function (r) {
    var name = text(r.cells[col.student]);
    if (!r.match) {
      r.gone = true;
      summary.gone.push({ name: name, section: sectionLabel_(r.cells[col.section]) });
      return;
    }
    var s = r.match;
    var from = normSection_(r.cells[col.section]), to = normSection_(s.section);
    if (from !== to) {
      summary.moved.push({ name: name, from: sectionLabel_(r.cells[col.section]), to: to || s.section });
      r.cells[col.section] = to || s.section;
      r.moved = true;
    }
    var renamed = baseName_(name) !== nameKey_(s.name);
    if (renamed) summary.renamed.push({ name: name, canvas: s.name });
    var refreshed = false;
    [[col.id, s.id], [col.sis, s.sis], [col.login, s.login], [col.canvasSection, s.section]].forEach(function (p) {
      if (text(r.cells[p[0]]) !== p[1]) { r.cells[p[0]] = p[1]; refreshed = true; }
    });
    if (refreshed && !r.moved) summary.refreshed++;
    if (!r.moved && !renamed && !refreshed) summary.unchanged++;
  });

  var adds = file.students.filter(function (s) { return !taken[s.id]; }).map(function (s) {
    var cells = header.map(function () { return ''; });
    cells[col.section] = normSection_(s.section) || s.section;
    cells[col.student] = s.name;
    cells[col.id] = s.id;
    cells[col.sis] = s.sis;
    cells[col.login] = s.login;
    cells[col.canvasSection] = s.section;
    return { cells: cells, student: s };
  });

  // Same section, same name: the app couldn't tell them apart, so new ones get their login added.
  var sameKey = function (cells) { return sectionLabel_(cells[col.section]) + '|' + nameKey_(cells[col.student]); };
  var count = {};
  filled.concat(adds).forEach(function (r) { var k = sameKey(r.cells); count[k] = (count[k] || 0) + 1; });
  adds.forEach(function (a) {
    if (count[sameKey(a.cells)] < 2) return;
    var tag = a.student.login.split('@')[0].toLowerCase() || a.student.id;
    a.cells[col.student] = a.student.name + ' (' + tag + ')';
    summary.madeUnique.push({ name: a.cells[col.student], section: sectionLabel_(a.cells[col.section]) });
  });
  var kept = {};
  filled.forEach(function (r) {
    if (r.gone) return;
    var k = sameKey(r.cells);
    if (kept[k]) summary.sameName.push({ name: text(r.cells[col.student]), section: sectionLabel_(r.cells[col.section]) });
    kept[k] = true;
  });

  var key = function (cells) { return rosterSortKey_(cells, col); };
  adds.sort(function (a, b) { return cmpRosterKey_(key(a.cells), key(b.cells)); });
  adds.forEach(function (a) { summary.added.push({ name: a.cells[col.student], section: sectionLabel_(a.cells[col.section]) }); });
  filled.concat(adds).forEach(function (r) {
    if (!r.gone && !normSection_(r.cells[col.section])) {
      summary.outside.push({ name: text(r.cells[col.student]), section: text(r.cells[col.section]) || '(none)' });
    }
  });

  return { summary: summary, sheet: sheet, header: header, hadHeader: hadHeader, addColumns: addColumns,
           col: col, rows: rows, adds: adds };
}

/** Writes a rosterPlan_ to the Roster tab. Returns how many students it removed. */
function writeRosterPlan_(ss, plan, removeGone) {
  var sheet = plan.sheet || rosterTabFor_(ss);
  var col = plan.col, width = plan.header.length;
  var key = function (cells) { return rosterSortKey_(cells, col); };
  var created = plan.summary.created;

  var need = 1 + plan.rows.length + plan.adds.length;   // plus one spare row: deleteRows can't empty the tab
  if (sheet.getMaxRows() < need + 1) sheet.insertRowsAfter(sheet.getMaxRows(), need + 1 - sheet.getMaxRows());
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (!plan.hadHeader || plan.addColumns.length) {
    sheet.getRange(1, 1, 1, width).setValues([plan.header]);
    sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  }
  if (!plan.hadHeader) sheet.setFrozenRows(1);
  // IDs stay text, so an SIS ID like 0012345 keeps its zeros.
  [col.id, col.sis, col.login, col.canvasSection].forEach(function (c) {
    sheet.getRange(2, c + 1, need - 1, 1).setNumberFormat('@');
  });
  if (plan.rows.length) {
    sheet.getRange(2, 1, plan.rows.length, width).setValues(plan.rows.map(function (r) {
      return r.cells.map(function (v, c) { return c === col.student ? safeText_(v) : v; });
    }));
  }

  // Moved students come out and go back in at their place in the new section.
  var out = plan.rows.filter(function (r) { return r.moved || (r.gone && removeGone); });
  var removed = out.filter(function (r) { return r.gone; }).length;
  for (var i = out.length - 1; i >= 0; ) {
    var end = out[i].at, start = end;
    while (i > 0 && out[i - 1].at === start - 1) { i--; start--; }
    sheet.deleteRows(start + 2, end - start + 1);
    i--;
  }
  var order = plan.rows.filter(function (r) { return out.indexOf(r) < 0; })
    .map(function (r) { return r.blank ? null : key(r.cells); });

  var inserts = plan.adds.concat(plan.rows.filter(function (r) { return r.moved; }))
    .map(function (r) { return { cells: r.cells.map(function (v, c) { return c === col.student ? safeText_(v) : v; }), key: key(r.cells) }; })
    .sort(function (a, b) { return cmpRosterKey_(a.key, b.key); });
  if (created || inserts.length > ROSTER_ONE_BY_ONE) {
    if (inserts.length) {
      var block = sheet.getRange(order.length + 2, 1, inserts.length, width);
      block.setValues(inserts.map(function (x) { return x.cells; }));
      if (!created) block.setBackground(ROSTER_FLAG_COLOR);
    }
  } else {
    inserts.forEach(function (x) {
      var p = 0;
      for (var j = order.length - 1; j >= 0; j--) {
        if (order[j] && cmpRosterKey_(order[j], x.key) <= 0) { p = j + 1; break; }
      }
      if (p < order.length) sheet.insertRowBefore(p + 2);
      sheet.getRange(p + 2, 1, 1, width).setValues([x.cells]).setBackground(ROSTER_FLAG_COLOR).setFontWeight('normal');
      order.splice(p, 0, x.key);
    });
  }
  if (created) sheet.autoResizeColumns(1, width);
  ss.setActiveSheet(sheet);
  return removed;
}

/** The Roster tab, made if it's missing. A new spreadsheet's one empty tab becomes it. */
function rosterTabFor_(ss) {
  var sheets = ss.getSheets();
  if (sheets.length === 1 && sheets[0].getLastRow() === 0) return sheets[0].setName(ROSTER_TAB);
  return ss.insertSheet(ROSTER_TAB);
}

/** [section's place in COURSE.sections (unknown sections last), name] for keeping the Roster in order. */
function rosterSortKey_(cells, col) {
  var i = COURSE.sections.indexOf(normSection_(cells[col.section]));
  return [i < 0 ? COURSE.sections.length : i, nameKey_(cells[col.student])];
}

function cmpRosterKey_(a, b) {
  return a[0] - b[0] || a[1].localeCompare(b[1]);
}

/** "DIS301" for a section in COURSE.sections, otherwise the cell's own text. */
function sectionLabel_(v) {
  return normSection_(v) || String(v === null || v === undefined ? '' : v).trim() || '(none)';
}

/** A name without a trailing "(...)", e.g. the login added to tell two students apart. */
function baseName_(s) {
  return nameKey_(s).replace(/\s*\([^()]*\)$/, '');
}

/** The students in a Canvas gradebook export: {students: [{name, id, sis, login, section}], skipped: [names]}. */
function readCanvasExport_(csvText) {
  var rows = parseCsv_(String(csvText || '').replace(/^﻿/, ''));
  var head = (rows[0] || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var pick = function (names) {
    for (var i = 0; i < names.length; i++) { if (head.indexOf(names[i]) >= 0) return head.indexOf(names[i]); }
    return -1;
  };
  var col = {
    name: pick(['student']),
    id: pick(['id', 'canvas id']),
    sis: pick(['sis user id']),
    login: pick(['sis login id']),
    section: pick(['canvas section', 'section'])
  };
  if (col.name < 0 || col.id < 0 || col.section < 0) {
    throw new Error('That file doesn\'t look like a Canvas gradebook export: its first row needs Student, ID ' +
      'and Section columns. In Canvas: Grades → Export → Export Entire Gradebook, then pick the file it downloads.');
  }
  var cell = function (row, c) { return c < 0 || row[c] === undefined ? '' : String(row[c]).replace(/\s+/g, ' ').trim(); };
  var students = [], skipped = [], seen = {};
  for (var i = 1; i < rows.length; i++) {
    var id = cell(rows[i], col.id), name = cell(rows[i], col.name);
    if (!/^\d+$/.test(id) || !name || seen[id]) continue;   // "Points Possible" and other rows that aren't students
    if (/^(student, test|test student)$/i.test(name)) { skipped.push(name); continue; }
    seen[id] = true;
    students.push({ name: name, id: id, sis: cell(rows[i], col.sis), login: cell(rows[i], col.login),
                    section: cell(rows[i], col.section) });
  }
  if (!students.length) throw new Error('That file has no students in it.');
  return { students: students, skipped: skipped };
}

/** CSV text -> rows of strings. Handles quoted fields, "" inside quotes, and line breaks inside quotes. */
function parseCsv_(s) {
  var rows = [], row = [], field = '', quoted = false;
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (quoted) {
      if (c !== '"') field += c;
      else if (s.charAt(i + 1) === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s.charAt(i + 1) === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

var ROSTER_DIALOG_HTML = `<!doctype html>
<html><head><base target="_top">
<style>
  body { font: 13px/1.45 Arial, Helvetica, sans-serif; color: #202124; margin: 0; padding: 0 4px 8px; }
  p { margin: 0 0 8px; }
  h4 { font-size: 13px; margin: 14px 0 2px; }
  h4 + p { margin-bottom: 4px; }
  ul { margin: 0; padding: 4px 8px 4px 24px; max-height: 112px; overflow: auto; background: #f1f3f4; border-radius: 4px; }
  li { margin: 1px 0; }
  ul + p { margin-top: 6px; }
  .note { color: #5f6368; }
  .error { color: #c5221f; }
  .warn { background: #fef7e0; border-left: 3px solid #f9ab00; padding: 6px 10px; margin: 12px 0 4px; }
  .warn p:last-child { margin: 0; }
  .swatch { background: #fff2a8; padding: 0 4px; border-radius: 2px; }
  label { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; }
  label input { margin: 2px 0 0; }
  .actions { display: flex; gap: 8px; margin-top: 10px; padding: 8px 0 2px; position: sticky; bottom: 0; background: #fff; }
  button { font: inherit; padding: 6px 16px; border-radius: 4px; border: 1px solid #dadce0; background: #fff;
    color: #1a73e8; cursor: pointer; }
  button.go { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  button:disabled { opacity: .55; cursor: default; }
</style></head>
<body>
<div id="pick">
  <p>In Canvas, choose <b>Grades → Export → Export Entire Gradebook</b>. Then pick the file it downloads, as it is.</p>
  <p><input type="file" id="file" accept=".csv,text/csv"></p>
</div>
<div id="out"><p class="note">Nothing changes until you've seen the changes and clicked <b>Update the roster</b>.</p></div>
<script>
  var csv = null;
  var out = document.getElementById('out');

  function el(tag, cls, kids) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    [].concat(kids || []).forEach(function (k) {
      if (k !== null && k !== undefined) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    });
    return e;
  }
  function list(items, line) { return el('ul', '', items.map(function (x) { return el('li', '', line(x)); })); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function show(nodes) { out.replaceChildren.apply(out, nodes.filter(Boolean)); }
  function fail(err) {
    document.getElementById('file').value = '';   // so picking the same file again counts as a change
    show([el('p', 'error', String(err && err.message || err).replace(/^Error: /, '')),
          el('p', 'note', 'Pick the file again to retry.')]);
  }
  function close() { google.script.host.close(); }
  function button(label, cls, onclick) { var b = el('button', cls, label); b.onclick = onclick; return b; }

  document.getElementById('file').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      csv = reader.result;
      show([el('p', 'note', 'Reading the file…')]);
      google.script.run.withSuccessHandler(function (s) { render(s, false); }).withFailureHandler(fail)
        .previewCanvasRoster(csv);
    };
    reader.onerror = function () { fail('That file couldn\\'t be read.'); };
    reader.readAsText(f);
  });

  function render(s, done) {
    var nodes = [];
    var bySection = function () {
      var n = {};
      s.added.forEach(function (a) { n[a.section] = (n[a.section] || 0) + 1; });
      return Object.keys(n).map(function (k) { return k + ': ' + n[k]; }).join(' · ');
    };
    if (done) {
      nodes.push(el('p', '', [el('b', '', 'Done. The Roster tab is updated.')]));
    } else {
      nodes.push(el('p', '', plural(s.inFile, 'student', 'students') + ' in this file.' +
        (s.skipped.length ? ' (The Test Student is left out.)' : '')));
    }
    if (s.noMatch) {
      nodes.push(el('div', 'warn', [el('p', '', [el('b', '', 'None of these students are on your Roster tab.'),
        ' Is this the right course\\'s gradebook? Nothing was changed.'])]));
      nodes.push(el('div', 'actions', [button('Close', '', close)]));
      return show(nodes);
    }
    var nothing = !s.created && !s.added.length && !s.moved.length && !s.gone.length && !s.refreshed;
    if (nothing) nodes.push(el('p', '', 'The Roster tab already matches this file. There\\'s nothing to change.'));

    if (s.created) {
      nodes.push(el('p', '', (done ? 'All ' + s.added.length + ' are' : 'Your Roster tab is empty, so all ' +
        s.added.length + ' go') + ' on it, by section and then name.'));
      nodes.push(el('p', 'note', bySection()));
    } else if (s.added.length) {
      nodes.push(el('h4', '', 'New students (' + s.added.length + ')'));
      nodes.push(el('p', 'note', ['Added in name order within their section and highlighted ',
        el('span', 'swatch', 'yellow'), '.']));
      nodes.push(list(s.added, function (a) { return a.name + ' · ' + a.section; }));
    }
    if (s.moved.length) {
      nodes.push(el('h4', '', 'Changed sections (' + s.moved.length + ')'));
      nodes.push(el('p', 'note', ['Moved to the new section and highlighted ', el('span', 'swatch', 'yellow'),
        ', so you can check their table and group.']));
      nodes.push(list(s.moved, function (m) { return m.name + ': ' + m.from + ' → ' + m.to; }));
    }
    var removeBox = null;
    if (s.gone.length) {
      nodes.push(el('h4', '', 'On the Roster but not in this file (' + s.gone.length + ')'));
      nodes.push(list(s.gone, function (g) { return g.name + ' · ' + g.section; }));
      if (done) {
        nodes.push(el('p', 'note', s.removed ? 'Removed from the Roster tab.' : 'Left on the Roster tab.'));
      } else {
        removeBox = el('input');
        removeBox.type = 'checkbox';
        nodes.push(el('label', '', [removeBox, el('span', '', 'Remove them from the Roster tab. Grades they ' +
          'already have stay on past days\\' tabs.')]));
      }
    }
    if (s.renamed.length) {
      nodes.push(el('h4', '', 'Named differently in Canvas (' + s.renamed.length + ')'));
      nodes.push(el('p', 'note', 'Their Roster names are kept, because past days\\' tabs use them. To change one, ' +
        'edit the Roster tab before anyone grades that student.'));
      nodes.push(list(s.renamed, function (r) { return r.name + ' (Canvas: ' + r.canvas + ')'; }));
    }
    if (s.madeUnique.length) {
      nodes.push(el('h4', '', 'Same name in one section (' + s.madeUnique.length + ')'));
      nodes.push(el('p', 'note', 'Their login is added to the name, so TAs can tell them apart.'));
      nodes.push(list(s.madeUnique, function (m) { return m.name + ' · ' + m.section; }));
    }
    if (s.sameName.length) {
      nodes.push(el('div', 'warn', [el('p', '', 'These students share a name with someone else in their ' +
        'section, and the app can\\'t tell them apart. On the Roster tab, add a middle initial or login to one name.'),
        list(s.sameName, function (m) { return m.name + ' · ' + m.section; })]));
    }
    if (s.outside.length) {
      nodes.push(el('h4', '', 'Not in any of your sections (' + s.outside.length + ')'));
      nodes.push(el('p', 'note', 'They\\'re on the Roster tab, but the app only shows the sections listed in the ' +
        'COURSE block in Settings.gs. If one belongs there, add it to that list.'));
      nodes.push(list(s.outside, function (o) { return o.name + ' · ' + o.section; }));
    }
    var counts = [];
    if (s.refreshed) counts.push('Canvas IDs filled in or updated: ' + s.refreshed + '.');
    if (s.unchanged && !nothing) counts.push('Already up to date: ' + s.unchanged + '.');
    if (counts.length) nodes.push(el('p', 'note', counts.join(' ')));

    if (done) {
      if (!nothing) nodes.push(el('p', 'note', 'Open copies of the app pick this up within 5 minutes. ' +
        'Reloading the app shows it right away.'));
      document.getElementById('pick').hidden = true;
      nodes.push(el('div', 'actions', [button('Close', 'go', close)]));
    } else if (nothing) {
      nodes.push(el('div', 'actions', [button('Close', '', close)]));
    } else {
      var go = button('Update the roster', 'go', function () {
        go.disabled = true;
        go.textContent = 'Updating…';
        google.script.run.withSuccessHandler(function (r) { render(r, true); }).withFailureHandler(fail)
          .applyCanvasRoster(csv, !!(removeBox && removeBox.checked));
      });
      nodes.push(el('div', 'actions', [go, button('Cancel', '', close)]));
    }
    show(nodes);
  }
</script>
</body></html>`;

/** Opens the "TA access" tab: the list of people allowed to open the app. */
function showAccess() {
  var ss = SpreadsheetApp.getActive();
  var sheet = accessTab_(ss);
  markPendingAccess_(sheet);
  ss.setActiveSheet(sheet);
}

/**
 * Puts every TA named in the roster on the TA access tab, with the Email column blank
 * for you to fill in. The list is the point: access fails closed, so a TA nobody
 * remembered to add is a TA locked out in the middle of class.
 */
function addTasFromRoster() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var sheet = accessTab_(ss);
  var names = taNamesFromRoster_();
  if (!names.length) {
    ui.alert('No TA names in the Roster tab',
      'This reads the Roster tab\'s "TA" column, or one per class day like "' + COURSE.classDays[0] + ' TA" ' +
      '(and the same for Lead and Support). Add the TAs to the access tab by hand instead.', ui.ButtonSet.OK);
    return;
  }

  var values = sheet.getDataRange().getValues();
  var have = {};
  for (var i = 1; i < values.length; i++) {
    var who = String(values[i][1]).trim().toLowerCase();
    if (who) have[who] = true;
  }
  var add = names.filter(function (n) { return !have[n.toLowerCase()]; });

  if (add.length) {
    sheet.getRange(Math.max(values.length, 1) + 1, 1, add.length, 3).setValues(add.map(function (n) {
      return ['', n, 'Needs their wisc.edu address'];
    }));
  }
  markPendingAccess_(sheet);
  ss.setActiveSheet(sheet);

  ui.alert(add.length ? 'Added ' + add.length + (add.length === 1 ? ' TA' : ' TAs') : 'Nothing to add',
    add.length
      ? 'Fill in the Email column for every yellow row: the address that TA signs in to Google with, ' +
        'normally NetID@wisc.edu. A row with no email lets nobody in.\n\n' +
        'Not sure which address someone uses? Put both in, on two rows. Or let them try the link once: ' +
        'they will be turned away, and the Access log will show the exact address to paste in.'
      : 'Every TA named in the roster is already on this tab.', ui.ButtonSet.OK);
}

/** Every distinct name in the roster's TA columns, alphabetical. */
function taNamesFromRoster_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(ROSTER_TAB);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var wanted = ['ta', 'lead', 'support'];
  COURSE.classDays.forEach(function (d) {
    d = d.toLowerCase();
    wanted.push(d + ' ta', d + ' lead', d + ' support');
  });
  var cols = wanted
    .map(function (h) { return header.indexOf(h); })
    .filter(function (c) { return c >= 0; });
  if (!cols.length) return [];

  var seen = {}, out = [];
  for (var i = 1; i < values.length; i++) {
    for (var j = 0; j < cols.length; j++) {
      var name = String(values[i][cols[j]]).trim();
      var key = name.toLowerCase();
      if (name && !seen[key]) {
        seen[key] = true;
        out.push(name);
      }
    }
  }
  return out.sort(function (a, b) { return a.localeCompare(b); });
}

/** Yellow means this row lets nobody in yet, the same way a yellow day row means no grade yet. */
function markPendingAccess_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var range = sheet.getRange(2, 1, last - 1, 3);
  range.setBackgrounds(range.getValues().map(function (row) {
    var pending = !normEmail_(row[0]) ? '#fff3c4' : null;
    return [pending, pending, pending];
  }));
}

/** Opens the "Access log" tab: everyone who was turned away. */
function showAccessLog() {
  var ss = SpreadsheetApp.getActive();
  ss.setActiveSheet(accessLogTab_(ss));
}

/** Opens the "Canvas assignments" tab, creating it from the syllabus schedule if it's missing. */
function showAssignments() {
  var ss = SpreadsheetApp.getActive();
  ss.setActiveSheet(ss.getSheetByName(ASSIGN_TAB) || assignmentsTab_(ss));
}

/** Opens the "Export log" tab: every Canvas import file made, by whom and when. */
function showExportLog() {
  var ss = SpreadsheetApp.getActive();
  ss.setActiveSheet(exportLogTab_(ss));
}

/**
 * Turns the class-day tab you're looking at into a "Canvas import" tab laid out
 * the way Canvas's Grades → Import expects. Students are matched to Canvas by the
 * IDs in the Roster tab. Students with no grade are left out, so Canvas leaves
 * them alone rather than entering anything. Grades only ever go into the existing
 * Canvas assignment set for that day on the "Canvas assignments" tab, never a new one.
 */
function makeCanvasImport() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var day = ss.getActiveSheet();
  var dayName = day.getName();
  if (!/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}\/\d{1,2}$/.test(dayName)) {
    ui.alert('First click the tab for the class day you want (like "Fri 9/11"), ' +
      'then choose Canvas → Make Canvas import from this day.');
    return;
  }
  var ids = canvasIds_(ss);
  if (!ids) {
    ui.alert('The Roster tab has no Canvas IDs. It needs "Canvas ID", "SIS User ID", ' +
      '"SIS Login ID" and "Canvas section" columns.');
    return;
  }

  // Canvas matches an import column to an existing assignment by the ID in parentheses.
  // A column without one would make Canvas create a new assignment, so never send that.
  var pick = assignmentFor_(ss, dayName);
  if (!pick.title) {
    ui.alert('No Canvas assignment is set for ' + dayName + '.\n\nPick one in column B of the "' +
      ASSIGN_TAB + '" tab, then run this again.' + (pick.note ? '\n\nNote on that row: ' + pick.note : ''));
    return;
  }
  if (!/\(\d+\)$/.test(pick.title)) {
    ui.alert('"' + pick.title + '" has no Canvas ID, so Canvas would create a new assignment instead of ' +
      'filling in the existing one.\n\nPick the assignment from the dropdown on the "' + ASSIGN_TAB +
      '" tab (it looks like "Discussion 1 (1234567)"), then run this again.');
    return;
  }
  var answer = ui.alert('Canvas import for ' + dayName,
    dayName + ' grades will go into the existing Canvas assignment ' + pick.title + '.' +
    (pick.others.length ? '\n\nHeads up: ' + pick.others.join(', ') + (pick.others.length === 1 ? ' is' : ' are') +
      ' also set to ' + pick.title + ' on the "' + ASSIGN_TAB + '" tab. For anyone graded on both days, ' +
      'this import replaces the other day\'s grade in Canvas.' : '') +
    '\n\nMake the import file?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  var title = pick.title;

  var rows = [
    ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', title],
    ['    Points Possible', '', '', '', '', COURSE.maxGrade]
  ];
  var ungraded = 0;
  var unmatched = [];
  var last = day.getLastRow();
  var values = last > 1 ? day.getRange(2, 1, last - 1, 5).getValues() : [];
  values.forEach(function (r) {
    var student = String(r[3]).trim();
    if (!student) return;
    var grade = gradeValue_(r[4]);
    if (grade === '') { ungraded++; return; }
    var who = canvasIdFor_(ids, r[0], student);
    if (!who) {
      unmatched.push({ section: normSection_(r[0]) || String(r[0]), table: tableValue_(r[1]), student: student, grade: grade });
      return;
    }
    rows.push([student, who[0], who[1], who[2], who[3], grade]);
  });

  var tab = ss.getSheetByName(CANVAS_TAB) || ss.insertSheet(CANVAS_TAB);
  tab.clear();
  tab.getRange(1, 2, rows.length, 3).setNumberFormat('@');   // keep IDs as text
  tab.getRange(1, 1, rows.length, 6).setValues(rows);
  tab.getRange(1, 1, 1, 6).setFontWeight('bold');
  tab.setFrozenRows(1);
  tab.autoResizeColumns(1, 6);
  updateHandTab_(ss, dayName, unmatched);
  logExport_(ss, dayName, title, rows.length - 2, unmatched.length, ungraded);
  ss.setActiveSheet(tab);

  var msg = (rows.length - 2) + ' grades for ' + dayName + ' are in the "' + CANVAS_TAB + '" tab.\n\n' +
    'To upload them:\n' +
    '1. File → Download → Comma-separated values (.csv)\n' +
    '2. In Canvas: Grades → Import → choose that file → Upload Data, then confirm.';
  if (ungraded) {
    msg += '\n\n' + ungraded + ' students have no grade for this day. They were left out, so Canvas won\'t change them.';
  }
  if (unmatched.length) {
    msg += '\n\n' + (unmatched.length === 1 ? 'This student isn\'t' : 'These students aren\'t') +
      ' on the Roster tab, so there\'s no Canvas ID to match and they\'re not in the file:\n' +
      unmatched.map(function (m) { return m.student + ' (' + m.section + '): ' + m.grade; }).join('\n') +
      '\n\nThey\'re listed on the "' + HAND_TAB + '" tab. Enter those grades in Canvas by hand, ' +
      'then tick "Entered in Canvas".';
  }
  ui.alert('Canvas import ready', msg, ui.ButtonSet.OK);
}

function exportLogTab_(ss) {
  var sheet = ss.getSheetByName(EXPORT_LOG_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(EXPORT_LOG_TAB);
  sheet.getRange(1, 1, 1, EXPORT_LOG_HEADER.length).setValues([EXPORT_LOG_HEADER])
    .setFontWeight('bold').setBackground('#e8edf2');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1).setNote('A row every time someone runs Canvas → Make Canvas import from this day. ' +
    'It records who made the file, not whether it was uploaded: the download and the Canvas upload happen ' +
    'outside this sheet. Canvas\'s Gradebook History shows who changed grades there. ' +
    'To see what grades a file held, look at the Change log for that day up to this time.');
  sheet.getRange('A:A').setNumberFormat('ddd m/d h:mm:ss am/pm');
  [170, 260, 90, 180, 110, 110, 140].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  return sheet;
}

/** Adds a row to the Export log tab. Newest at the bottom, like the Change log. */
function logExport_(ss, dayName, title, inFile, byHand, ungraded) {
  try {
    exportLogTab_(ss).appendRow([new Date(), safeText_(currentEmail_() || '(unknown)'),
      dayName, safeText_(title), inFile, byHand, ungraded]);
  } catch (e) {
    // The import file is already made; a failed log line shouldn't hide that.
  }
}

/**
 * Keeps a running list of graded students the Canvas import couldn't include (not on the
 * Roster tab), so the list outlives the pop-up. Re-running the menu for a day replaces that
 * day's rows; other days' rows and their ticks stay. A tick carries over only if the grade
 * hasn't changed since it was entered in Canvas.
 */
function updateHandTab_(ss, dayName, missing) {
  var sheet = ss.getSheetByName(HAND_TAB);
  if (!sheet) {
    if (!missing.length) return;
    sheet = ss.insertSheet(HAND_TAB);
    sheet.getRange(1, 1, 1, HAND_HEADER.length).setValues([HAND_HEADER])
      .setFontWeight('bold').setBackground('#e8edf2');
    sheet.getRange(1, 1).setNote('Students graded in the app who aren\'t on the Roster tab, so the Canvas import ' +
      'can\'t include them. Enter each grade in Canvas by hand, then tick "Entered in Canvas". Adding the student ' +
      '(with their Canvas IDs) to the Roster tab and re-running the Canvas menu for that day moves them into the ' +
      'import file and off this list.');
    sheet.setFrozenRows(1);
    [90, 70, 55, 220, 60, 130].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  }

  var last = sheet.getLastRow();
  var old = last > 1 ? sheet.getRange(2, 1, last - 1, HAND_HEADER.length).getValues() : [];
  var tickedGrade = {};
  var rows = [];
  old.forEach(function (r) {
    var student = String(r[3]).trim();
    if (!student) return;
    var day = dayLabel_(r[0]);
    if (day === dayName) {
      if (r[5] === true) tickedGrade[r[1] + '|' + nameKey_(student)] = String(r[4]);
    } else {
      rows.push([day, r[1], r[2], student, r[4], r[5] === true]);
    }
  });
  missing.forEach(function (m) {
    var ticked = tickedGrade[m.section + '|' + nameKey_(m.student)] === String(m.grade);
    rows.push([dayName, m.section, m.table, m.student, m.grade, ticked]);
  });
  rows.sort(function (a, b) {
    return dayOrder_(b[0]) - dayOrder_(a[0]) || String(a[1]).localeCompare(String(b[1])) ||
      String(a[3]).localeCompare(String(b[3]));
  });

  if (last > 1) sheet.getRange(2, 1, last - 1, HAND_HEADER.length).clearContent().removeCheckboxes();
  if (!rows.length) return;
  rows.forEach(function (r) { r[3] = safeText_(r[3]); });
  sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');    // keep "Fri 9/11" as text, not a date
  sheet.getRange(2, 6, rows.length, 1).insertCheckboxes();      // before setValues: this resets the cells
  sheet.getRange(2, 1, rows.length, HAND_HEADER.length).setValues(rows);
}

/** A class-day cell back as its tab name, even if Sheets turned it into a date. */
function dayLabel_(v) {
  if (v instanceof Date) return WEEKDAYS[v.getDay()] + ' ' + (v.getMonth() + 1) + '/' + v.getDate();
  return String(v).trim();
}

/** "Fri 9/11" -> 911, for ordering class days within a semester. */
function dayOrder_(name) {
  var m = String(name).match(/(\d{1,2})\/(\d{1,2})/);
  return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
}

/** {title, note, others}: the Canvas assignment set for a class day, and any other days set to the same one. */
function assignmentFor_(ss, dayName) {
  var sheet = ss.getSheetByName(ASSIGN_TAB) || assignmentsTab_(ss);
  var last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, 3).getValues() : [];
  var out = { title: '', note: '', others: [] };
  rows.forEach(function (r) {
    if (dayLabel_(r[0]) === dayName) { out.title = String(r[1]).trim(); out.note = String(r[2]).trim(); }
  });
  if (out.title) {
    rows.forEach(function (r) {
      var d = dayLabel_(r[0]);
      if (d && d !== dayName && String(r[1]).trim() === out.title) out.others.push(d);
    });
  }
  return out;
}

/** Creates the "Canvas assignments" tab: every class day, its assignment (from DA_SCHEDULE), and a pick list. */
function assignmentsTab_(ss) {
  var sheet = ss.insertSheet(ASSIGN_TAB);
  var rows = classDays_().map(function (d) { return [d, DA_SCHEDULE[d] || '', DA_NOTES[d] || '']; });
  sheet.getRange(1, 1, 1, 5).setValues([['Class day', 'Canvas assignment', 'Note', '', 'Canvas assignments to pick from']])
    .setFontWeight('bold');
  sheet.getRange(1, 1).setNote('Which Canvas assignment each class day\'s grades go into. The Canvas menu only ' +
    'fills in the assignment picked here, matched by the Canvas ID in parentheses; it never creates one. ' +
    'Change a day with the dropdown in column B. To add an assignment ' +
    'to the dropdown, put its column name from a Canvas gradebook export in column E.');
  sheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');        // keep "Fri 9/11" as text, not a date
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  if (CANVAS_DAS.length) {
    sheet.getRange(2, 5, CANVAS_DAS.length, 1).setValues(CANVAS_DAS.map(function (a) { return [a]; }));
  }
  sheet.getRange(2, 2, rows.length, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sheet.getRange(2, 5, 100, 1), true)
    .setAllowInvalid(false)
    .setHelpText('Pick from the list in column E. If an assignment is missing, add its column name ' +
      'from a Canvas gradebook export there first, exactly as it appears, e.g. "Discussion 1 (1234567)".')
    .build());
  sheet.setFrozenRows(1);
  [90, 150, 380, 30, 210].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  return sheet;
}

/** Every class day of the semester as tab names ("Wed 9/2" ...), from the COURSE block. */
function classDays_() {
  var out = [];
  for (var t = utcDay_(COURSE.firstDay); t <= utcDay_(COURSE.lastDay); t += 86400000) {
    var d = new Date(t);
    if (COURSE.classDays.indexOf(WEEKDAYS[d.getUTCDay()]) >= 0) {
      out.push(WEEKDAYS[d.getUTCDay()] + ' ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate());
    }
  }
  return out;
}

/**
 * Canvas IDs from the Roster tab, or null if it has none: {bySection: {"DIS301|name": ids}, byName: {name: ids}},
 * where ids = [Canvas ID, SIS User ID, SIS Login ID, Canvas section]. A key two students share maps to null.
 */
function canvasIds_(ss) {
  var values = ss.getSheetByName(ROSTER_TAB).getDataRange().getValues();
  var header = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var col = {
    rosterSection: header.indexOf('section'),
    student: header.indexOf('student'),
    id: header.indexOf('canvas id'),
    sis: header.indexOf('sis user id'),
    login: header.indexOf('sis login id'),
    section: header.indexOf('canvas section')
  };
  if (col.student < 0 || col.id < 0) return null;
  var cell = function (row, c) { return c < 0 ? '' : String(row[c]).trim(); };
  var out = { bySection: Object.create(null), byName: Object.create(null) };
  var put = function (map, k, ids) { map[k] = k in map ? null : ids; };
  for (var i = 1; i < values.length; i++) {
    var name = cell(values[i], col.student);
    var id = cell(values[i], col.id);
    if (!name || !id) continue;
    var ids = [id, cell(values[i], col.sis), cell(values[i], col.login), cell(values[i], col.section)];
    put(out.bySection, normSection_(values[i][col.rosterSection]) + '|' + nameKey_(name), ids);
    put(out.byName, nameKey_(name), ids);
  }
  return out;
}

/**
 * A day-tab student's Canvas IDs, or null. Matched by section and name; a walk-in graded in another
 * section (say, after switching) is matched by name alone if no one else has that name. Two students
 * with one name in one section match nobody, so a grade can never go to the wrong one.
 */
function canvasIdFor_(ids, section, student) {
  var k = normSection_(section) + '|' + nameKey_(student);
  return k in ids.bySection ? ids.bySection[k] : ids.byName[nameKey_(student)] || null;
}

function nameKey_(s) { return String(s).replace(/\s+/g, ' ').trim().toLowerCase(); }

// ---------------------------------------------------------------- helpers

function dayState_(date) {
  var cache = CacheService.getScriptCache();
  var keys = cacheKeys_(date);
  var got = cache.getAll(keys);
  if (got[keys[0]] && got[keys[1]]) return { v: got[keys[0]], d: got[keys[1]] };

  // Rebuild under the lock so a slow read can't overwrite a newer save in the cache.
  var lock = LockService.getScriptLock();
  var locked = lock.tryLock(10000);
  try {
    got = cache.getAll(keys);
    if (got[keys[0]] && got[keys[1]]) return { v: got[keys[0]], d: got[keys[1]] };
    var state = { v: newVersion_(), d: JSON.stringify(readDay_(date)) };
    if (locked) cache.putAll(pair_(keys, state), DAY_CACHE_SECONDS);
    return state;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function readDay_(date) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(tabName_(date));
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, DAY_HEADER.length).getValues();
  rows.forEach(function (r) {
    var section = normSection_(r[0]);
    var name = String(r[3]).trim();
    if (!section || !name) return;
    out[section + '|' + name] = [
      gradeValue_(r[4]),
      String(r[5]),
      r[6] instanceof Date ? r[6].getTime() : 0,
      tableValue_(r[1]),
      String(r[2]).trim(),
      isLate_(r[7]),
      timeValue_(r[8]),
      lateMinutes_(r[9])
    ];
  });
  return out;
}

/** The tab for one class day, created from the roster the first time it's needed. */
function dayTab_(ss, date) {
  var name = tabName_(date);
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  var roster = rosterData_();
  var rows = [];
  COURSE.sections.forEach(function (s) {
    roster[s].forEach(function (r) { rows.push([s, r[1], r[2], safeText_(r[0]), '', '', '', '', '', '']); });
  });

  sheet = ss.insertSheet(name, 0);
  sheet.getRange(1, 1, 1, DAY_HEADER.length).setValues([DAY_HEADER])
    .setFontWeight('bold').setBackground('#e8edf2');
  if (rows.length) sheet.getRange(2, 1, rows.length, DAY_HEADER.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 55);
  sheet.setColumnWidth(3, 55);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 70);
  sheet.setColumnWidth(6, 200);
  sheet.setColumnWidth(7, 130);
  sheet.setColumnWidth(8, 55);
  sheet.setColumnWidth(9, 130);
  sheet.setColumnWidth(10, 95);

  var body = sheet.getMaxRows() - 1;
  sheet.getRange(2, 5, body, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireNumberBetween(0, COURSE.maxGrade)
      .setAllowInvalid(false)
      .setHelpText('Grades are numbers from 0 to ' + COURSE.maxGrade + '.')
      .build());
  sheet.getRange(2, 7, body, 1).setNumberFormat('ddd h:mm am/pm');
  sheet.getRange(2, 9, body, 1).setNumberFormat('ddd h:mm am/pm');
  // Late flags are amber; students still missing a grade are highlighted yellow.
  sheet.setConditionalFormatRules([
    lateRule_(sheet),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($D2<>"",$E2="")')
      .setBackground('#fff3c4')
      .setRanges([sheet.getRange(2, 1, body, DAY_HEADER.length)])
      .build()
  ]);
  sheet.getRange(1, 1, sheet.getMaxRows(), DAY_HEADER.length).createFilter();
  return sheet;
}

function logTab_(ss) {
  var sheet = ss.getSheetByName(LOG_TAB);
  if (sheet) return sheet;
  sheet = ss.insertSheet(LOG_TAB);
  sheet.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER])
    .setFontWeight('bold').setBackground('#e8edf2');
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('ddd m/d h:mm:ss am/pm');
  return sheet;
}

/** "2026-09-11" -> "Fri 9/11" */
function tabName_(date) {
  var p = date.split('-').map(Number);
  var weekday = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  return WEEKDAYS[weekday] + ' ' + p[1] + '/' + p[2];
}

function checkDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Bad date: ' + date);
}

function parseGrade_(g) {
  if (g === null || g === undefined || String(g).trim() === '') return '';
  var n = Number(g);
  if (!isFinite(n) || n < 0 || n > COURSE.maxGrade) {
    throw new Error('Grades must be numbers from 0 to ' + COURSE.maxGrade + '.');
  }
  return Math.round(n * 100) / 100;
}

function gradeValue_(v) {
  if (v === null || v === undefined || v === '') return '';
  return typeof v === 'number' ? v : String(v).trim();
}

function isLate_(v) {
  return v === true || /^late$/i.test(String(v === null || v === undefined ? '' : v).trim());
}

/**
 * How late, as one of lateChoices_(), or '' if not recorded. Reads 15, "15", "11–15", "15 min" and "26+".
 * Anything with a + is the last step, so a "25+" from before the 1–5 step (Oct 23) keeps its max of 4.
 */
function lateMinutes_(v) {
  var s = String(v === null || v === undefined ? '' : v);
  if (s.indexOf('+') >= 0) return lateChoices_()[lateChoices_().length - 1];
  var n = parseInt(s.replace(/^.*[-–—]/, ''), 10);
  return lateChoices_().indexOf(n) >= 0 ? n : '';
}

/** What the Minutes late column shows: "1–5", "6–10", … "21–25" or "26+". */
function minutesCell_(minutes) {
  var i = lateChoices_().indexOf(minutes);
  if (i < 0) return '';
  if (i === lateChoices_().length - 1) return minutes + '+';
  var from = i ? lateChoices_()[i - 1] + 1 : 1;
  return from === minutes ? String(minutes) : from + '–' + minutes;
}

/** For the Change log: "not late", "late", or "late 11–15 min". */
function lateText_(late, minutes) {
  return !late ? 'not late' : minutes === '' ? 'late' : 'late ' + minutesCell_(minutes) + ' min';
}

function timeValue_(v) {
  return v instanceof Date ? v.getTime() : 0;
}

function checkSection_(section) {
  if (COURSE.sections.indexOf(section) < 0) throw new Error('Unknown section: ' + section);
  return section;
}

function checkStudent_(student) {
  var name = String(student || '').trim().slice(0, 200);
  if (!name) throw new Error('Missing student name.');
  return name;
}

/**
 * The day-tab row for a student: {row, table, group, values}. A student who isn't on the tab yet
 * (a walk-in a TA added, e.g. someone who switched sections) gets a new row at the bottom.
 */
function findRow_(sheet, section, student, p) {
  var last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, DAY_HEADER.length).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (normSection_(rows[i][0]) === section && String(rows[i][3]).trim() === student) {
      return { row: i + 2, table: tableValue_(rows[i][1]), group: String(rows[i][2]).trim(), values: rows[i] };
    }
  }
  var table = tableValue_(p.table);
  var group = String(p.group || '').trim().slice(0, 2).toUpperCase();
  sheet.getRange(last + 1, 1, 1, 4).setValues([[section, table, group, safeText_(student)]]);
  return { row: last + 1, table: table, group: group, values: [section, table, group, student, '', '', '', '', '', ''] };
}

function logChange_(ss, when, date, section, student, before, after, who) {
  logTab_(ss).appendRow([when, tabName_(date), section, safeText_(student), before, after, safeText_(who)]);
}

/** Keeps the cached day current so every open copy of the app sees a change on its next poll. */
function updateDayCache_(date, key, entry) {
  var cache = CacheService.getScriptCache();
  var keys = cacheKeys_(date);
  var cached = cache.get(keys[1]);
  if (cached) {
    var day = JSON.parse(cached);
    day[key] = entry;
    cache.putAll(pair_(keys, { v: newVersion_(), d: JSON.stringify(day) }), DAY_CACHE_SECONDS);
  } else {
    cache.removeAll(keys);
  }
}

/** Day tabs made before late flags (or minutes late) existed get those columns the first time someone is flagged. */
function ensureLateColumns_(sheet) {
  if (!String(sheet.getRange(1, 8).getValue()).trim()) {
    sheet.getRange(1, 8, 1, 2).setValues([DAY_HEADER.slice(7, 9)]).setFontWeight('bold').setBackground('#e8edf2');
    sheet.setColumnWidth(8, 55);
    sheet.setColumnWidth(9, 130);
    sheet.getRange(2, 9, sheet.getMaxRows() - 1, 1).setNumberFormat('ddd h:mm am/pm');
    var rules = sheet.getConditionalFormatRules();
    rules.unshift(lateRule_(sheet));
    sheet.setConditionalFormatRules(rules);
  }
  if (!String(sheet.getRange(1, 10).getValue()).trim()) {
    sheet.getRange(1, 10).setValue(DAY_HEADER[9]).setFontWeight('bold').setBackground('#e8edf2');
    sheet.setColumnWidth(10, 95);
  }
}

function lateRule_(sheet) {
  return SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(LATE_MARK)
    .setBackground('#ffd8a8')
    .setRanges([sheet.getRange(2, 8, sheet.getMaxRows() - 1, 1)])
    .build();
}

function tableValue_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (s === '') return '';
  var n = Number(s);
  return isFinite(n) ? n : s;
}

/**
 * One of COURSE.sections, or null. Reads "DIS301", "dis301", a bare "301" (or 301), and Canvas's own
 * section text ("E M A 303:DIS301 and E M A 303:LEC001"), so a Canvas export's Section column works as is.
 */
function normSection_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  if (!s) return null;
  var i, upper = COURSE.sections.map(function (x) { return String(x).toUpperCase(); });
  i = upper.indexOf(s);
  if (i >= 0) return COURSE.sections[i];
  var words = s.split(/[^A-Z0-9]+/);
  for (var w = 0; w < words.length; w++) {
    i = upper.indexOf(words[w]);
    if (i >= 0) return COURSE.sections[i];
  }
  if (/^\d+$/.test(s)) {
    var hits = COURSE.sections.filter(function (x) { var m = String(x).match(/(\d+)$/); return m && Number(m[1]) === Number(s); });
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** Text starting with = + - @ would be read as a formula; store it as plain text. */
function safeText_(s) {
  s = String(s);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function currentEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

/* ------------------------------------------------------------------ *
 * Who can open the app
 *
 * The web app is deployed to the whole campus ("Anyone within
 * University of Wisconsin-Madison"), because that is what makes Google
 * offer a TA an account picker instead of a dead end. But campus is
 * about a hundred thousand accounts, including every student in this
 * course, so the domain check is not the access control: the "TA access"
 * tab is. Only the addresses listed there get past doGet, and every
 * function the app calls checks again, so a blocked person can't reach
 * the data by calling the server directly either.
 *
 * It fails closed. An empty tab locks everyone out except the owner,
 * which is the safe direction to fail on student grades.
 * ------------------------------------------------------------------ */

/** Throws unless the person calling is on the TA access tab. Every entry point starts here. */
function requireTa_() {
  var email = normEmail_(currentEmail_());
  if (email && allowedEmails_()[email]) return email;
  logDenied_(email);
  throw new Error(email
    ? 'This app is for ' + COURSE.name + ' TAs, and ' + email + ' is not on the list. ' +
      'Ask the instructor to add you to the "TA access" tab.'
    : 'Sign in with your UW-Madison account (NetID@wisc.edu) to use this app.');
}

/** {email: true} from the TA access tab, plus whoever owns the script. */
function allowedEmails_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('access');
  if (hit) return JSON.parse(hit);

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(ACCESS_TAB) || accessTab_(ss);
  var values = sheet.getDataRange().getValues();
  var out = {};
  var owner = normEmail_(ownerEmail_());
  if (owner) out[owner] = true;                 // the owner can never lock themselves out
  for (var i = 1; i < values.length; i++) {
    var email = normEmail_(values[i][0]);
    if (email) out[email] = true;
  }
  cache.put('access', JSON.stringify(out), ACCESS_CACHE_SECONDS);
  return out;
}

function normEmail_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/** The account the script runs as: the person who set it up. */
function ownerEmail_() {
  try {
    return Session.getEffectiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}

function accessTab_(ss) {
  var sheet = ss.getSheetByName(ACCESS_TAB);
  if (sheet) return sheet;
  try {
    sheet = ss.insertSheet(ACCESS_TAB);
  } catch (e) {
    return ss.getSheetByName(ACCESS_TAB);       // two people opened the app at once; one of them made it
  }
  sheet.getRange(1, 1, 1, ACCESS_HEADER.length).setValues([ACCESS_HEADER])
    .setFontWeight('bold').setBackground('#e8edf2');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1).setNote('One UW email per row: these are the only people who can open the grading app. ' +
    'Everyone else gets a "this app is for ' + COURSE.name + ' TAs" page, even with the link and a wisc.edu account. ' +
    'Add or remove a row and it takes effect within a minute. ' +
    'Use the address the TA signs in to Google with, normally NetID@wisc.edu.');
  var owner = ownerEmail_();
  if (owner) sheet.getRange(2, 1, 1, 2).setValues([[owner, 'Course instructor (set up the app)']]);
  [260, 220, 320].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  return sheet;
}

function accessLogTab_(ss) {
  var sheet = ss.getSheetByName(ACCESS_LOG_TAB);
  if (sheet) return sheet;
  try {
    sheet = ss.insertSheet(ACCESS_LOG_TAB);
  } catch (e) {
    return ss.getSheetByName(ACCESS_LOG_TAB);
  }
  sheet.getRange(1, 1, 1, ACCESS_LOG_HEADER.length).setValues([ACCESS_LOG_HEADER])
    .setFontWeight('bold').setBackground('#e8edf2');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1).setNote('Every time someone who is not on the TA access tab tries to open the app. ' +
    'A TA you forgot to add shows up here once, and so does a link that has wandered somewhere it should not be. ' +
    'Successful opens are not logged: this tab is meant to stay short enough to read.');
  sheet.getRange('A:A').setNumberFormat('ddd m/d h:mm:ss am/pm');
  [170, 260, 320].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  return sheet;
}

/**
 * Note a blocked attempt on the Access log tab. The same person is logged at most
 * once every DENY_QUIET_SECONDS, so a phone retrying in a loop can't fill the tab.
 */
function logDenied_(email) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'deny:' + (email || 'anon');
    if (cache.get(key)) return;
    cache.put(key, '1', DENY_QUIET_SECONDS);
    accessLogTab_(SpreadsheetApp.getActive())
      .appendRow([new Date(), email || '(not signed in)',
        email ? 'Blocked: not on the TA access tab' : 'Blocked: not signed in to a UW account']);
  } catch (e) {
    // Logging must never be the thing that breaks the app.
  }
}

/** What someone who isn't a TA sees instead of the roster. Shows no student data. */
function denyPage_(email) {
  var who = email
    ? 'This browser is signed in to <b>' + escapeHtml_(email) + '</b>, which isn\'t on the list.'
    : 'This browser isn\'t signed in to a UW-Madison account.';
  var html =
    '<style>' +
    'body{font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
    'margin:0;padding:40px 20px;color:#1f2933;background:#f4f6f8}' +
    'main{max-width:31em;margin:0 auto;background:#fff;border-radius:10px;padding:26px 24px;' +
    'box-shadow:0 1px 3px rgba(0,0,0,.14)}' +
    'h1{font-size:19px;margin:0 0 14px}p{margin:0 0 12px}' +
    'ul{margin:0 0 4px 0;padding:0 0 0 20px}li{margin:0 0 10px}' +
    '.q{color:#5c6b7a;font-size:14px;margin-top:20px;border-top:1px solid #e3e8ee;padding-top:14px}' +
    '</style>' +
    '<main>' +
    '<h1>This app is for ' + escapeHtml_(COURSE.name) + ' TAs</h1>' +
    '<p>' + who + '</p>' +
    '<ul>' +
    '<li><b>Wrong account?</b> Open this link again in a private window and sign in as NetID@wisc.edu, ' +
    'or switch accounts from the Google account picker.</li>' +
    '<li><b>Already on your UW account?</b> Ask the instructor to add you to the ' +
    '<b>TA access</b> tab of the grades spreadsheet. It takes about ten seconds.</li>' +
    '</ul>' +
    '<p class="q">No student information is on this page.</p>' +
    '</main>';
  return HtmlService.createHtmlOutput(html)
    .setTitle(COURSE.name + ' Grades')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cacheKeys_(date) { return ['v:' + date, 'd:' + date]; }

function pair_(keys, state) {
  var o = {};
  o[keys[0]] = state.v;
  o[keys[1]] = state.d;
  return o;
}

function newVersion_() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
