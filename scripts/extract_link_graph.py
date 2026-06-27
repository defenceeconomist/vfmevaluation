from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import yaml


DEFAULT_ROOT = Path(__file__).resolve().parent.parent
EXCLUDE_PARTS = {".quarto", "_site", "site_libs", "assets", "data", "scripts"}
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+)\)")
URL_RE = re.compile(r"https?://[^\s<>{}\"')]+")
CITATION_RE = re.compile(r"(?<![\w/])@([A-Za-z0-9_:.+-]+)")
BIB_ENTRY_RE = re.compile(r"@(?P<entry_type>[A-Za-z]+)\s*\{\s*(?P<key>[^,\s]+)\s*,", re.M)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the VfM evaluation notes link graph payload from the Quarto source tree."
    )
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--include-prefix", action="append", default=[])
    return parser.parse_args()


def resolve_path(root: Path, path: Path | None, fallback: str) -> Path:
    if path is None:
        return root / fallback
    return path if path.is_absolute() else root / path


def load_config(config_path: Path) -> dict:
    return yaml.safe_load(config_path.read_text(encoding="utf-8"))


def normalize_prefix(prefix: str) -> str:
    normalized = prefix.strip().lstrip("./")
    return normalized.rstrip("/")


def iter_qmd_files(root: Path, include_prefixes: list[str] | None = None) -> list[Path]:
    files: list[Path] = []
    normalized_prefixes = [normalize_prefix(prefix) for prefix in include_prefixes or [] if prefix.strip()]
    for path in root.rglob("*.qmd"):
        rel = path.relative_to(root)
        if any(part in EXCLUDE_PARTS for part in rel.parts):
            continue
        rel_posix = rel.as_posix()
        if normalized_prefixes and not any(
            rel_posix == prefix or rel_posix.startswith(f"{prefix}/") for prefix in normalized_prefixes
        ):
            continue
        files.append(path)
    return sorted(files)


def parse_front_matter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    front = yaml.safe_load(text[4:end]) or {}
    body = text[end + 5 :]
    return front, body


def title_case(value: str) -> str:
    parts = re.split(r"[-_]", value)
    return " ".join(part[:1].upper() + part[1:] for part in parts if part)


def label_from_rel(rel_path: Path) -> str:
    if rel_path.as_posix() == "index.qmd":
        return "Value for Money Evaluation Knowledge Base"
    if rel_path.name == "index.qmd":
        return title_case(rel_path.parent.name)
    return title_case(rel_path.stem)


def clean_url(url: str) -> str:
    parsed = urlparse(url.strip().strip("<>").rstrip(".,};:"))
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", parsed.query, ""))


def clean_text(value: str) -> str:
    compact = re.sub(r"\s+", " ", value.replace("\n", " ")).strip()
    while len(compact) >= 2 and compact[0] == "{" and compact[-1] == "}":
        compact = compact[1:-1].strip()
    while len(compact) >= 2 and compact[0] == '"' and compact[-1] == '"':
        compact = compact[1:-1].strip()
    return compact


def normalize_internal_target(root: Path, source_rel: Path, target: str) -> str | None:
    cleaned = target.strip().strip("<>").split("#", 1)[0].split("?", 1)[0]
    if not cleaned or cleaned.startswith(("http://", "https://", "mailto:", "javascript:")):
        return None
    candidate = (root / source_rel.parent / cleaned).resolve()
    try:
        rel = candidate.relative_to(root.resolve())
    except ValueError:
        return None
    if any(part in EXCLUDE_PARTS for part in rel.parts):
        return None
    if rel.suffix.lower() == ".qmd":
        return rel.as_posix()
    if rel.suffix.lower() == ".html":
        return rel.with_suffix(".qmd").as_posix()
    return None


def strip_noncontent_blocks(body: str) -> str:
    without_fences = re.sub(r"```.*?```", "", body, flags=re.S)
    without_scripts = re.sub(r"<script\b.*?</script>", "", without_fences, flags=re.S | re.I)
    without_styles = re.sub(r"<style\b.*?</style>", "", without_scripts, flags=re.S | re.I)
    return without_styles


def extract_linkable_text(body: str) -> str:
    stripped = strip_noncontent_blocks(body)
    kept_lines: list[str] = []
    for line in stripped.splitlines():
        if line.lstrip().startswith("<"):
            continue
        kept_lines.append(line)
    return "\n".join(kept_lines)


def extract_citable_text(body: str) -> str:
    stripped = strip_noncontent_blocks(body)
    return re.sub(r"`[^`]*`", "", stripped)


def bibliography_paths(root: Path, source_rel: Path, front: dict, config: dict) -> list[Path]:
    candidates: list[Path] = []

    global_bib = config.get("bibliography")
    if isinstance(global_bib, str):
        candidates.append(Path(global_bib) if Path(global_bib).is_absolute() else (root / global_bib).resolve())
    elif isinstance(global_bib, list):
        for item in global_bib:
            if isinstance(item, str):
                candidates.append(Path(item) if Path(item).is_absolute() else (root / item).resolve())

    local_bib = front.get("bibliography")
    if isinstance(local_bib, str):
        candidates.append(
            Path(local_bib)
            if Path(local_bib).is_absolute()
            else (root / source_rel.parent / local_bib).resolve()
        )
    elif isinstance(local_bib, list):
        for item in local_bib:
            if isinstance(item, str):
                candidates.append(
                    Path(item) if Path(item).is_absolute() else (root / source_rel.parent / item).resolve()
                )

    resolved: list[Path] = []
    seen: set[Path] = set()
    for path in candidates:
        if path.exists() and path not in seen:
            seen.add(path)
            resolved.append(path)
    return resolved


def parse_balanced_value(text: str, start: int) -> tuple[str, int]:
    depth = 0
    chars: list[str] = []
    index = start
    while index < len(text):
        char = text[index]
        if char == "{":
            depth += 1
            if depth > 1:
                chars.append(char)
        elif char == "}":
            depth -= 1
            if depth == 0:
                return "".join(chars), index + 1
            chars.append(char)
        else:
            chars.append(char)
        index += 1
    return "".join(chars), index


def parse_quoted_value(text: str, start: int) -> tuple[str, int]:
    chars: list[str] = []
    index = start + 1
    escaped = False
    while index < len(text):
        char = text[index]
        if escaped:
            chars.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
            chars.append(char)
        elif char == '"':
            return "".join(chars), index + 1
        else:
            chars.append(char)
        index += 1
    return "".join(chars), index


def parse_bib_entry_fields(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    index = 0
    while index < len(body):
        while index < len(body) and body[index] in " \t\r\n,":
            index += 1
        if index >= len(body):
            break

        field_start = index
        while index < len(body) and re.match(r"[A-Za-z0-9_-]", body[index]):
            index += 1
        field_name = body[field_start:index].strip().lower()
        if not field_name:
            index += 1
            continue

        while index < len(body) and body[index].isspace():
            index += 1
        if index >= len(body) or body[index] != "=":
            next_comma = body.find(",", index)
            if next_comma == -1:
                break
            index = next_comma + 1
            continue
        index += 1

        while index < len(body) and body[index].isspace():
            index += 1
        if index >= len(body):
            break

        if body[index] == "{":
            raw_value, index = parse_balanced_value(body, index)
        elif body[index] == '"':
            raw_value, index = parse_quoted_value(body, index)
        else:
            value_start = index
            while index < len(body) and body[index] not in ",\r\n":
                index += 1
            raw_value = body[value_start:index]

        cleaned = clean_text(raw_value)
        if cleaned:
            fields[field_name] = cleaned

    return fields


def parse_bibtex_entries(bib_path: Path) -> dict[str, dict]:
    text = bib_path.read_text(encoding="utf-8")
    entries: dict[str, dict] = {}
    for match in BIB_ENTRY_RE.finditer(text):
        key = clean_text(match.group("key"))
        depth = 1
        index = match.end()
        while index < len(text):
            char = text[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    body = text[match.end() : index]
                    fields = parse_bib_entry_fields(body)
                    fields["entry_type"] = match.group("entry_type").lower()
                    fields["key"] = key
                    entries[key] = fields
                    break
            index += 1
    return entries


def load_bibliography_entries(bib_paths: list[Path], cache: dict[Path, dict[str, dict]]) -> dict[str, dict]:
    entries: dict[str, dict] = {}
    for bib_path in bib_paths:
        if bib_path.suffix.lower() != ".bib":
            continue
        if bib_path not in cache:
            cache[bib_path] = parse_bibtex_entries(bib_path)
        entries.update(cache[bib_path])
    return entries


def bibliography_id(citation_key: str) -> str:
    return f"cite:{citation_key}"


def truncate_label(label: str, limit: int = 46) -> str:
    if len(label) <= limit:
        return label
    return f"{label[: limit - 3].rstrip()}..."


def bibliography_label(entry: dict, citation_key: str) -> str:
    title = clean_text(entry.get("title", ""))
    if title:
        return truncate_label(title)
    author = clean_text(entry.get("author", ""))
    year = clean_text(entry.get("year", ""))
    fallback = " ".join(part for part in [author, year] if part).strip()
    return truncate_label(fallback or citation_key)


def bibliography_url(entry: dict) -> str | None:
    url = clean_text(entry.get("url", ""))
    if url:
        return clean_url(url)
    doi = clean_text(entry.get("doi", ""))
    if doi:
        return clean_url(f"https://doi.org/{doi}")
    return None


def merge_external_node(external_nodes: dict[str, dict], node_id: str, payload: dict) -> None:
    existing = external_nodes.get(node_id, {})
    merged = {**existing, **payload}
    merged["id"] = node_id
    merged["kind"] = "external"
    external_nodes[node_id] = merged


def extract_hrefs(items: list | None) -> list[str]:
    hrefs: list[str] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        href = item.get("href")
        if href:
            hrefs.append(href)
        hrefs.extend(extract_hrefs(item.get("contents")))
    return hrefs


def external_label(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.replace("www.", "")
    path_parts = [part for part in parsed.path.split("/") if part]
    tail = path_parts[-1] if path_parts else host
    tail = tail.replace(".html", "").replace(".htm", "").replace("-", " ").replace("_", " ")
    label = f"{host}: {tail}".strip()
    if len(label) > 38:
        return f"{label[:35].rstrip()}..."
    return label


def add_edge(edges: dict[tuple[str, str], dict], source: str, target: str, kind: str) -> None:
    if not source or not target or source == target:
        return
    edges[(source, target)] = {"source": source, "target": target, "kind": kind}


def build_payload(root: Path, config: dict, include_prefixes: list[str] | None = None) -> dict:
    page_nodes: dict[str, dict] = {}
    external_nodes: dict[str, dict] = {}
    edges: dict[tuple[str, str], dict] = {}
    bibliography_cache: dict[Path, dict[str, dict]] = {}
    normalized_prefixes = [normalize_prefix(prefix) for prefix in include_prefixes or [] if prefix.strip()]

    for path in iter_qmd_files(root, normalized_prefixes):
        rel = path.relative_to(root)
        front, body = parse_front_matter(path.read_text(encoding="utf-8"))
        linkable_body = extract_linkable_text(body)
        citable_body = extract_citable_text(body)
        citation_entries = load_bibliography_entries(bibliography_paths(root, rel, front, config), bibliography_cache)
        node_id = rel.as_posix()
        page_nodes[node_id] = {
            "id": node_id,
            "label": str(front.get("title") or label_from_rel(rel)),
            "kind": "internal",
            "path": node_id,
        }

        for raw_target in MARKDOWN_LINK_RE.findall(linkable_body):
            if raw_target.startswith(("http://", "https://")):
                url = clean_url(raw_target)
                merge_external_node(external_nodes, url, {"label": external_label(url), "url": url})
                add_edge(edges, node_id, url, "external")
                continue

            internal_target = normalize_internal_target(root, rel, raw_target)
            if internal_target and (
                not normalized_prefixes
                or any(
                    internal_target == prefix or internal_target.startswith(f"{prefix}/")
                    for prefix in normalized_prefixes
                )
            ):
                add_edge(edges, node_id, internal_target, "internal")

        for url in URL_RE.findall(linkable_body):
            cleaned = clean_url(url)
            merge_external_node(external_nodes, cleaned, {"label": external_label(cleaned), "url": cleaned})
            add_edge(edges, node_id, cleaned, "external")

        for citation_key in sorted(set(CITATION_RE.findall(citable_body))):
            entry = citation_entries.get(citation_key)
            if not entry:
                continue
            external_id = bibliography_id(citation_key)
            merge_external_node(
                external_nodes,
                external_id,
                {
                    "label": bibliography_label(entry, citation_key),
                    "url": bibliography_url(entry),
                    "citation_key": citation_key,
                    "title": clean_text(entry.get("title", "")),
                },
            )
            add_edge(edges, node_id, external_id, "external")

    website = config.get("website", {})
    for sidebar in website.get("sidebar", []):
        contents = sidebar.get("contents", [])
        overview = next((item.get("href") for item in contents if isinstance(item, dict) and item.get("href")), None)
        overview_target = normalize_internal_target(root, Path("index.qmd"), overview) if overview else None
        if not overview_target:
            continue
        for href in extract_hrefs(contents):
            target = normalize_internal_target(root, Path("index.qmd"), href)
            if target and target in page_nodes and overview_target in page_nodes:
                add_edge(edges, overview_target, target, "internal")

    incoming: defaultdict[str, set[str]] = defaultdict(set)
    outgoing: defaultdict[str, set[str]] = defaultdict(set)
    neighbors: defaultdict[str, set[str]] = defaultdict(set)

    for edge in edges.values():
        source = edge["source"]
        target = edge["target"]
        outgoing[source].add(target)
        incoming[target].add(source)
        neighbors[source].add(target)
        neighbors[target].add(source)

    connected_ids = set(neighbors)
    nodes: list[dict] = []
    for node_id, node in page_nodes.items():
        if node_id != "index.qmd" and node_id not in connected_ids:
            continue
        nodes.append(
            {
                **node,
                "incoming": len(incoming[node_id]),
                "outgoing": len(outgoing[node_id]),
                "degree": len(neighbors[node_id]),
            }
        )

    for node_id, node in external_nodes.items():
        if node_id not in connected_ids:
            continue
        nodes.append(
            {
                **node,
                "incoming": len(incoming[node_id]),
                "outgoing": len(outgoing[node_id]),
                "degree": len(neighbors[node_id]),
            }
        )

    nodes.sort(key=lambda item: (item["kind"], item["label"].lower(), item["id"]))
    edge_list = sorted(edges.values(), key=lambda item: (item["source"], item["target"]))
    return {"nodes": nodes, "edges": edge_list}


def main() -> None:
    args = parse_args()
    root = args.root.resolve()
    config_path = resolve_path(root, args.config, "_quarto.yml")
    output_path = resolve_path(root, args.output, "data/notes_link_graph_payload.json")
    config = load_config(config_path)
    payload = build_payload(root, config, args.include_prefix)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
