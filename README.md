# Overtime Report Generator

A browser-based overtime (OT) calculator built for Sri Lankan government and institutional payroll rules — no backend, no build step.

**🔗 Live demo:** 

Developed with ❤️ by [V.P.R. Lakshan Vidanapathirana](https://lakshan.netlify.app/)

---

## ✨ Features

- **Government OT rules built in**
  - Standard office hours (default 8:30 AM – 4:15 PM), fully configurable
  - Grace-period late arrivals automatically shift the OT start time
  - The first full hour of overtime must be completed before any OT is granted
  - Extra time beyond that first hour only counts once it reaches a full block (with a minimum of two blocks), so a single leftover block isn't paid on its own
  - Separate rule for weekends/public holidays — the entire time worked counts as OT
  - Configurable OT block size (15 / 30 / 45 minutes, multi-selectable)
  - Optional online/work-from-home session(s) — add as many as needed for the same day, on top of the office session
- **Calendar-based entry** — Monday–Sunday layout with Sundays highlighted, monthly navigation, and a "This month vs. Custom period" switch for pay periods that don't align to the calendar month
- **Quick-fill** — populate every empty weekday in a month with standard hours in one click, so you only need to touch the exceptional days
- **Multi-language UI** — English, Sinhala (සිංහල), Tamil (தமிழ்) — reports are always generated in English regardless of the UI language
- **Dark / light theme**, mobile-responsive layout
- **Custom time picker** — type a time directly or drag the analog clock face for minute-by-minute precision
- **Auto-save** to the browser's local storage, with a "last saved" indicator
- **Export** to PDF and Excel (.xlsx), plus a full JSON backup that can be re-imported later to keep editing

## 🚀 Getting started

1. Clone or download this repository.
2. Open `index.html` in a browser — or enable **GitHub Pages** (Settings → Pages → deploy from the `main` branch) to host it online.
3. No build tools, servers, or dependencies to install. All third-party libraries (jsPDF, SheetJS) load from a CDN at runtime.

## 📁 Project structure

```
index.html    Markup and layout
style.css     Design system (light/dark themes, responsive layout)
i18n.js       English / Sinhala / Tamil translation dictionaries
script.js     App logic — OT engine, calendar, time picker, import/export
```

## ⚙️ Configuring OT rules for your institution

Open the settings (gear icon) to adjust:

- Standard start / end time and grace period
- OT block size (15 / 30 / 45 minutes)
- OT rates for weekday, weekend/holiday, and WFH sessions
- Institution and employee name (shown on exported reports)

All settings and entries are stored locally in the browser — nothing is sent to a server.

## 📄 License

Feel free to fork and adapt for your own institution. Please keep the footer credit intact.
