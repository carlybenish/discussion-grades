# Discussion Grades

A live grading app for discussion sections. TAs enter grades on their phones, every grade lands in a Google Sheet
as it's typed, and a menu in the Sheet turns a class day into a Canvas import file. It runs in your own UW Google
account: no server, nothing to pay for, and the grades stay with you.

## What's here

| File | What it is |
|---|---|
| **Setup guide.pdf** | Start here. Setup takes about half an hour, and starting mid-semester is fine. |
| **Code.gs**, **Index.html** | The app. You paste these into Google Apps Script and never edit them. |
| **Settings.gs** | Your course's settings: name, sections, class days, grades, late steps. You paste it once, then edit it. |
| **Example roster.csv** | Made-up students, showing what the Roster tab looks like once it's filled in. |

To get a file onto your computer, click it, then click the download button (↓) at the top right of the file.

## Updating

When **What's changed** below lists something new:

1. Open **Code.gs** on this page. Click the **Copy raw file** button (two overlapping squares, top right of the
   file), then paste it over everything in your Apps Script project's `Code.gs`.
2. Do the same with **Index.html**, pasting over your `Index` file.
3. Leave your `Settings` file alone, unless the change says otherwise. Updates never replace it.
4. Save, then **Deploy → Manage deployments**, click the pencil ✏️, set **Version** to *New version*, and click
   **Deploy**. The TA link stays the same.
5. Reload the spreadsheet, so its menus pick up the change.

To change a setting later, edit `Settings` in Apps Script, save, and deploy a new version the same way.

If you have a GitHub account, **Watch** this page (top right) to get an email when it changes.

### One-time step if you set up before October 23, 2026

Your settings used to be at the top of Code.gs. Move them before you paste the new Code.gs:

1. In your current `Code.gs`, copy the **YOUR COURSE** block (from `var COURSE = {` to `};`) into a note. If you
   filled in `CANVAS_DAS`, `DA_SCHEDULE` or `DA_NOTES` lower down, copy those too.
2. In Apps Script, click **+** next to Files, choose **Script**, and name it `Settings`.
3. Paste **Settings.gs** from this page into it, then put your own values from step 1 back in.
4. Then update Code.gs and Index.html as above.

## What's changed

**October 23, 2026**

- **Settings have their own file**, Settings.gs, so updates never overwrite them. If you set up before today, do
  the one-time step above.
- **Roster → Update from Canvas.** Pick a Canvas gradebook export, just as it downloads, and it builds or updates
  the Roster tab. It shows what it will change first. New students and section changes are highlighted, your
  Table, Group and TA columns stay as they are, and students who dropped are removed only if you say so.
- **Names.** Names up to 200 characters are kept whole (it was 80). When two students share a name, each grade now
  goes to the right student in Canvas, matched by section; if the app can't tell them apart, the grade goes to the
  Enter by hand tab instead of to the wrong student.
- **Late button.** The picker now fits six ranges on a phone. New setups start with one point off per 5 minutes
  (1–5 min → 9, 6–10 → 8, … 26+ → 4). If you already have `lateSteps` in your settings, yours stay.
