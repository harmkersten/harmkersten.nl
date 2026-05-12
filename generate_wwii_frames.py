"""
Genereer 88 losse GeoJSON bestanden voor de WOII slider tool.
Vereisten: pip install geopandas topojson simplification

Gebruik:
    python generate_wwii_frames.py <pad_naar_EuropeanBorders_WWII_map> <output_map>

Voorbeeld:
    python generate_wwii_frames.py ./EuropeanBorders_WWII ./wwii_frames
"""

import sys, os, json, warnings
import geopandas as gpd
import topojson as tp
from shapely.geometry import mapping

warnings.filterwarnings('ignore')

TOLERANCE = 0.005  # Verlaag naar 0.002 voor hogere kwaliteit (~8MB per frame)

MONTH_MAP = {
    'January':1,'February':2,'March':3,'April':4,'May':5,'June':6,
    'July':7,'August':8,'September':9,'October':10,'November':11,'December':12
}

def parse_date(fname):
    parts = fname.replace('.shp','').split('_')
    return f"{int(parts[2])}-{MONTH_MAP[parts[0]]:02d}-{int(parts[1]):02d}"

def process_frame(shp_path, out_path, tolerance):
    gdf = gpd.read_file(shp_path).to_crs('EPSG:4326')
    topo = tp.Topology(gdf, prequantize=False)
    result = topo.toposimplify(tolerance, simplify_with='simplification').to_gdf()
    features = []
    for _, row in result.iterrows():
        if row.geometry is None or row.geometry.is_empty:
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "name": row['Name'],
                "foreign_power": str(row.get('Foreign_Po', '') or '')
            },
            "geometry": mapping(row.geometry)
        })
    with open(out_path, 'w') as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, separators=(',', ':'))
    return os.path.getsize(out_path) / 1024

def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    input_dir = sys.argv[1]
    output_dir = sys.argv[2]
    os.makedirs(output_dir, exist_ok=True)

    shp_files = sorted([
        f for f in os.listdir(input_dir)
        if f.endswith('.shp') and f != 'Territorial_Changes.shp'
    ])

    print(f"Gevonden: {len(shp_files)} shapefiles")
    print(f"Output: {output_dir}")
    print(f"Tolerance: {TOLERANCE}\n")

    sizes = []
    for i, fname in enumerate(shp_files):
        date_str = parse_date(fname)
        out_path = os.path.join(output_dir, f"{date_str}.geojson")

        if os.path.exists(out_path):
            size_kb = os.path.getsize(out_path) / 1024
            print(f"[{i+1:2d}/{len(shp_files)}] {date_str} — al aanwezig ({size_kb:.0f}KB)")
            sizes.append(size_kb)
            continue

        shp_path = os.path.join(input_dir, fname)
        size_kb = process_frame(shp_path, out_path, TOLERANCE)
        sizes.append(size_kb)
        print(f"[{i+1:2d}/{len(shp_files)}] {date_str}: {size_kb:.0f}KB")

    print(f"\nKlaar! {len(sizes)} bestanden")
    print(f"Gemiddeld: {sum(sizes)/len(sizes):.0f}KB")
    print(f"Totaal: {sum(sizes)/1024:.0f}MB")
    print(f"\nZet de map '{output_dir}' naast grenzen-filter.html op je server.")

if __name__ == '__main__':
    main()
