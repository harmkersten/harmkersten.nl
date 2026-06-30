#!/usr/bin/env python3
"""
Regenereert logos/manifest.json door de hele logos-map te scannen.

Gebruik:
    cd sportstats          # de map met index.html en de logos-map erin
    python3 generate_manifest.py

Voeg gewoon nieuwe PNG/SVG-bestanden toe in (sub)mappen onder logos/,
draai dit script, en de zoekfunctie in de tool vindt ze automatisch.
"""
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOGOS_DIR = os.path.join(SCRIPT_DIR, "logos")
MANIFEST_PATH = os.path.join(LOGOS_DIR, "manifest.json")
VALID_EXT = (".png", ".svg", ".jpg", ".jpeg")

def main():
    if not os.path.isdir(LOGOS_DIR):
        print(f"Geen 'logos' map gevonden naast dit script ({LOGOS_DIR}).")
        sys.exit(1)

    manifest = []
    for root, dirs, files in os.walk(LOGOS_DIR):
        # sla verborgen mappen/bestanden over (zoals .DS_Store, .git)
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if f.startswith(".") or not f.lower().endswith(VALID_EXT):
                continue
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, SCRIPT_DIR).replace(os.sep, "/")
            manifest.append(rel_path)

    manifest.sort()

    with open(MANIFEST_PATH, "w", encoding="utf-8") as out:
        json.dump(manifest, out, ensure_ascii=False, indent=0)

    print(f"manifest.json bijgewerkt: {len(manifest)} bestanden gevonden.")
    print(f"Geschreven naar: {MANIFEST_PATH}")

if __name__ == "__main__":
    main()
