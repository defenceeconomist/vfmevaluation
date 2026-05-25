# Value for Money Evaluation Knowledge Base

This repository contains a Quarto website for source-based notes on value for money (VfM) evaluation.

The site starts with Julian King and Oxford Policy Management's approach to assessing value for money. Additional sources should be added as focused notes with BibTeX entries and cross-links, so the knowledge map remains useful as the site grows.

## Structure

```text
.
├── _quarto.yml
├── README.md
├── index.qmd
├── references.bib
├── notes/
│   ├── index.qmd
│   └── opm-king-vfm-guidance.qmd
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

## Adding Sources

1. Add a BibTeX entry to `references.bib`.
2. Create a new `.qmd` note under `notes/`.
3. Cite sources with Pandoc citation keys such as `@king_opm_2018_vfm`.
4. Link related notes using relative `.qmd` links so the network graph can discover internal relationships.
5. Re-run `quarto render` and check `_site/notes/index.html`.

Avoid adding empty folders before there is content for them. The site should stay source-driven and easy to navigate.
