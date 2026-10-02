"""Cleaning up model Markdown output."""
import re

def drop_empty_sections(md: str) -> str:
    """Models sometimes write '## Shopping list' then '*No items mentioned.*' despite being told to
    leave empty sections out; remove sections with no real content."""
    out, block = [], []

    def flush():
        if not block:
            return
        body = [l for l in block[1:] if l.strip()]
        empty = block[0].startswith("## ") and (not body or all(
            re.match(r"^\s*[-*_(]*\s*(no|none|nothing|n/a)\b", l.strip(), re.I) for l in body))
        if not empty:
            out.extend(block)

    for line in md.split("\n"):
        if line.startswith("## "):
            flush()
            block = [line]
        else:
            block.append(line) if block else out.append(line)
    flush()
    return "\n".join(out).strip()

def dedupe_lines(text: str) -> str:
    """Drop repeated bullet lines (what a model stuck in a loop produces)."""
    seen, out = set(), []
    for line in text.split("\n"):
        key = re.sub(r"\s+", " ", line.strip().lower())
        if key.startswith(("-", "*")) and len(key) > 6:
            if key in seen:
                continue
            seen.add(key)
        out.append(line)
    return "\n".join(out)
