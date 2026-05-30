# Value for Money Evaluation Knowledge Base

This repository contains a Quarto website for source-based notes and evaluator-facing reports on value for money (VfM) evaluation.

The site brings together guidance from King, Oxford Policy Management, Verian, HM Treasury, the Ministry of Defence, the National Audit Office, OECD DAC, Department for Transport, and UK government sourcing guidance. Notes should stay source-based, cited, and cross-linked so the knowledge map remains useful as the site grows.

## Site Contents

- `notes/`: source notes and synthesis notes. These are included in the notes network diagram.
- `reports/`: applied evaluator-facing reports. These are separate from the notes network diagram.
- `NOTES.md`: release notes and change log.
- `references.bib`: shared bibliography used by notes and reports.
- `data/notes_link_graph_payload.json`: generated link-graph payload for the notes map.
- `assets/`: shared CSS, JavaScript, and vendored browser assets.
- `_site/`: rendered website output.

## Structure

```text
.
├── _quarto.yml
├── NOTES.md
├── README.md
├── index.qmd
├── references.bib
├── notes/
│   ├── index.qmd
│   └── *.qmd
├── reports/
│   ├── index.qmd
│   └── *.qmd
├── assets/
│   ├── css/
│   ├── js/
│   └── vendor/
├── scripts/
│   └── extract_link_graph.py
├── data/
│   └── notes_link_graph_payload.json
└── _site/
    └── rendered website output
```

## Render

Render the site from the repository root:

```bash
quarto render
```

Quarto writes rendered output to `_site/`. The pre-render step updates `data/notes_link_graph_payload.json`, which powers the notes network diagram.

For focused checks, render individual pages:

```bash
quarto render notes/verian-value-for-investment-guidance.qmd --to html
quarto render reports/defence-vfm-guidance.qmd --to html
```

Some reports declare HTML, PDF, and DOCX formats. Render those pages without `--to html` when the alternate outputs need updating:

```bash
quarto render reports/defence-vfm-guidance.qmd
```

## Adding Notes

1. Add a BibTeX entry to `references.bib`.
2. Create a new `.qmd` note under `notes/`.
3. Cite sources with Pandoc citation keys such as `@king_opm_2018_vfm`.
4. Link related notes using relative `.qmd` links so the network graph can discover internal relationships.
5. Re-run `quarto render` and check `_site/notes/index.html`.

## Adding Reports

1. Create a new `.qmd` report under `reports/`.
2. Add the report to `reports/index.qmd`.
3. Add the report to the `reports` sidebar in `_quarto.yml`.
4. Cite source notes and bibliography entries rather than duplicating source material without traceability.
5. Render the report and then render `reports` to check navigation:

```bash
quarto render reports/new-report.qmd
quarto render reports --to html --quiet
```

## Release Notes

Update `NOTES.md` for release-level changes. Include user-facing additions, substantial content revisions, structural site changes, source updates, and rendered-output changes that matter to readers.

Avoid adding empty folders before there is content for them. The site should stay source-driven and easy to navigate.
