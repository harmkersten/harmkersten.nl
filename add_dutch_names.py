"""
Voegt een Nederlandse naam (name_nl) toe als property aan alle GeoJSON bestanden.
Gebruik: python3 add_dutch_names.py <pad_naar_harmkersten.nl_repo>

Bijv: python3 add_dutch_names.py ~/Documents/prive/harmkersten.nl
"""

import json, os, sys, glob

# ── Vertaaltabel Engels → Nederlands ──────────────────────────────────────────
NL = {
    # A
    "Aden": "Aden",
    "Afghanistan": "Afghanistan",
    "Alaska": "Alaska",
    "Albania": "Albanië",
    "Algeria": "Algerije",
    "Andorra": "Andorra",
    "Angola": "Angola",
    "Anhalt": "Anhalt",
    "Anhalt-Bernberg": "Anhalt-Bernburg",
    "Anhalt-Dessau": "Anhalt-Dessau",
    "Argentina": "Argentinië",
    "Armenia": "Armenië",
    "Australia": "Australië",
    "Austria": "Oostenrijk",
    "Austria-Hungary": "Oostenrijk-Hongarije",
    "Azerbaijan": "Azerbeidzjan",
    # B
    "Baden": "Baden",
    "Bahamas": "Bahama's",
    "Bahrain": "Bahrein",
    "Bangladesh": "Bangladesh",
    "Barbados": "Barbados",
    "Bavaria": "Beieren",
    "Belarus (Byelorussia)": "Wit-Rusland",
    "Belgium": "België",
    "Belize": "Belize",
    "Benin": "Benin",
    "Bhutan": "Bhutan",
    "Bokhara": "Boechara",
    "Bolivia": "Bolivia",
    "Bosnia": "Bosnië",
    "Bosnia-Herzegovina": "Bosnië-Herzegovina",
    "Botswana": "Botswana",
    "Brazil": "Brazilië",
    "Bremen": "Bremen",
    "British Bechuanaland": "Brits Bechuanaland",
    "British Cameroons": "Brits Kameroen",
    "British Somaliland (Somaliland Republic)": "Brits Somaliland",
    "British Togoland": "Brits Togoland",
    "Brunei": "Brunei",
    "Bulgaria": "Bulgarije",
    "Burkina Faso (Upper Volta)": "Burkina Faso",
    "Burundi": "Burundi",
    # C
    "Cambodia (Kampuchea)": "Cambodja",
    "Cameroon": "Kameroen",
    "Canada": "Canada",
    "Cape Colony": "Kaapkolonie",
    "Cape Verde": "Kaapverdië",
    "Carpatho-Ukraine": "Karpato-Oekraïne",
    "Central African Republic": "Centraal-Afrikaanse Republiek",
    "Chad": "Tsjaad",
    "Chechens": "Tsjetsjenië",
    "Chile": "Chili",
    "China": "China",
    "Circassia": "Tsjerkessië",
    "Colombia": "Colombia",
    "Comoros": "Comoren",
    "Congo": "Congo",
    "Congo, Democratic Republic of (Zaire)": "Congo (Democratische Republiek)",
    "Costa Rica": "Costa Rica",
    "Cote D'Ivoire": "Ivoorkust",
    "Cracow": "Krakau",
    "Croatia": "Kroatië",
    "Cuba": "Cuba",
    "Cyprus": "Cyprus",
    "Czech Republic": "Tsjechië",
    "Czecho-Slovakia": "Tsjecho-Slowakije",
    "Czechoslovakia": "Tsjecho-Slowakije",
    # D
    "Danzig": "Danzig",
    "Denmark": "Denemarken",
    "Djibouti": "Djibouti",
    "Dominican Republic": "Dominicaanse Republiek",
    # E
    "East Aden Protectorate": "Oost-Aden Protectoraat",
    "East Timor": "Oost-Timor",
    "Ecuador": "Ecuador",
    "Egypt": "Egypte",
    "El Salvador": "El Salvador",
    "Equatorial Guinea": "Equatoriaal-Guinea",
    "Eritrea": "Eritrea",
    "Estonia": "Estland",
    "Ethiopia": "Ethiopië",
    # F
    "Federated Malay States": "Gefedereerde Maleise Staten",
    "Federation of Rhodesia and Nyasaland": "Federatie van Rhodesië en Nyasaland",
    "Federation of South Arabia": "Federatie van Zuid-Arabië",
    "Fiji": "Fiji",
    "Finland": "Finland",
    "France": "Frankrijk",
    "Frankfurt": "Frankfurt",
    "French Guyana": "Frans-Guyana",
    "French Polynesia": "Frans-Polynesië",
    "French West Africa": "Frans West-Afrika",
    # G
    "Gabon": "Gabon",
    "Gambia": "Gambia",
    "Gaza": "Gaza",
    "General Government": "Generaalgouvernement",
    "Georgia": "Georgië",
    "German Democratic Republic": "Oost-Duitsland (DDR)",
    "German Federal Republic": "West-Duitsland (BRD)",
    "German Solomon Islands": "Duitse Salomonseilanden",
    "German Togoland": "Duits Togoland",
    "Germany": "Duitsland",
    "Germany (Prussia)": "Duitsland (Pruisen)",
    "Ghana": "Ghana",
    "Gibraltar": "Gibraltar",
    "Greece": "Griekenland",
    "Guadeloupe": "Guadeloupe",
    "Guatemala": "Guatemala",
    "Guinea": "Guinea",
    "Guinea-Bissau": "Guinee-Bissau",
    "Guyana": "Guyana",
    # H
    "Haiti": "Haïti",
    "Hanover": "Hannover",
    "Hawaii": "Hawaï",
    "Herzegovina": "Herzegovina",
    "Hesse-Darmstadt (Ducal": "Hessen-Darmstadt",
    "Hesse-Homburg": "Hessen-Homburg",
    "Hesse-Kassel (Electoral)": "Hessen-Kassel",
    "Hohengeroldseck": "Hohengeroldseck",
    "Hohenzollern-Hechingen": "Hohenzollern-Hechingen",
    "Hohenzollern-Sigmaringen": "Hohenzollern-Sigmaringen",
    "Honduras": "Honduras",
    "Hungary": "Hongarije",
    # I
    "Iceland": "IJsland",
    "India": "India",
    "Indonesia": "Indonesië",
    "Inini": "Inini",
    "Iran (Persia)": "Iran (Perzië)",
    "Iraq": "Irak",
    "Ireland": "Ierland",
    "Israel": "Israël",
    "Italian Social Republic": "Italiaanse Sociale Republiek",
    "Italian Somaliland": "Italiaans Somaliland",
    "Italy": "Italië",
    "Italy/Sardinia": "Italië/Sardinië",
    # J
    "Jamaica": "Jamaica",
    "Jammu and Kashmir": "Jammu en Kasjmir",
    "Japan": "Japan",
    "Jordan": "Jordanië",
    # K
    "Kamerun": "Kameroen (Duits)",
    "Kashmir (North, Azad)": "Azad Kasjmir",
    "Kazakhstan": "Kazachstan",
    "Kenya": "Kenia",
    "Khiva": "Chiwa",
    "Kingdom of Naples": "Koninkrijk Napels",
    "Korea": "Korea",
    "Korea, People's Republic of": "Noord-Korea",
    "Korea, Republic of": "Zuid-Korea",
    "Kosovo": "Kosovo",
    "Kuwait": "Koeweit",
    "Kyrgyz Republic": "Kirgizië",
    # L
    "Lagos": "Lagos",
    "Laos": "Laos",
    "Latvia": "Letland",
    "Lebanon": "Libanon",
    "Lesotho": "Lesotho",
    "Liberia": "Liberia",
    "Libya": "Libië",
    "Liechtenstein": "Liechtenstein",
    "Lippe-Detmold": "Lippe-Detmold",
    "Lithuania": "Litouwen",
    "Lucca": "Lucca",
    "Luxembourg": "Luxemburg",
    # M
    "Macedonia (FYROM/North Macedonia)": "Noord-Macedonië",
    "Madagascar (Malagasy)": "Madagaskar",
    "Malawi": "Malawi",
    "Malaysia": "Maleisië",
    "Maldives": "Maldiven",
    "Mali": "Mali",
    "Malta": "Malta",
    "Martinique": "Martinique",
    "Massa": "Massa",
    "Mauritania": "Mauritanië",
    "Mauritius": "Mauritius",
    "Mecklenburg-Schwerin": "Mecklenburg-Schwerin",
    "Mecklenburg-Strelitz": "Mecklenburg-Strelitz",
    "Mexico": "Mexico",
    "Modena": "Modena",
    "Moldova": "Moldavië",
    "Monaco": "Monaco",
    "Mongolia": "Mongolië",
    "Montenegro": "Montenegro",
    "Morocco": "Marokko",
    "Mozambique": "Mozambique",
    "Myanmar (Burma)": "Myanmar (Birma)",
    # N
    "Namibia": "Namibië",
    "Nassau": "Nassau",
    "Natal": "Natal",
    "Nepal": "Nepal",
    "Netherlands": "Nederland",
    "New Caledonia and Dependencies": "Nieuw-Caledonië",
    "New Guinea (German New Guinea) (Kaiser Wilhelmsland)": "Duits Nieuw-Guinea",
    "New South Wales": "Nieuw-Zuid-Wales",
    "New Zealand": "Nieuw-Zeeland",
    "Newfoundland": "Newfoundland",
    "Nicaragua": "Nicaragua",
    "Niger": "Niger",
    "Nigeria": "Nigeria",
    "Northeastern Rhodesia": "Noordoost-Rhodesië",
    "Northern Nigeria": "Noord-Nigeria",
    "Northwestern Rhodesia": "Noordwest-Rhodesië",
    "Norway": "Noorwegen",
    # O
    "Oil Rivers Protectorate": "Oil Rivers Protectoraat",
    "Oldenburg": "Oldenburg",
    "Oman": "Oman",
    "Orange Free State": "Oranje Vrijstaat",
    "Ottoman Empire": "Ottomaans Rijk",
    # P
    "Pahang": "Pahang",
    "Pakistan": "Pakistan",
    "Palestine": "Palestina",
    "Panama": "Panama",
    "Papal States": "Pauselijke Staten",
    "Papua": "Papoea",
    "Papua New Guinea": "Papoea-Nieuw-Guinea",
    "Paraguay": "Paraguay",
    "Parma": "Parma",
    "Perak": "Perak",
    "Peru": "Peru",
    "Philippines": "Filipijnen",
    "Piedmont": "Piëmont",
    "Poland": "Polen",
    "Portugal": "Portugal",
    "Protectorate of Bohemia Moravia": "Protectoraat Bohemen en Moravië",
    "Protectorate of Bohemia and Moravia": "Protectoraat Bohemen en Moravië",
    "Puerto Rico": "Puerto Rico",
    # Q
    "Qatar": "Qatar",
    "Queensland": "Queensland",
    # R
    "Reichkommissariat Ostland": "Reichskommissariat Ostland",
    "Reichskommissariat Ostland": "Reichskommissariat Ostland",
    "Reichskommissariat Ukraine": "Reichskommissariat Oekraïne",
    "Reunion": "Réunion",
    "Reuss": "Reuss",
    "Romania": "Roemenië",
    "Rumania": "Roemenië",
    "Russia": "Rusland",
    "Russia (Soviet Union)": "Rusland (Sovjet-Unie)",
    "Rwanda": "Rwanda",
    "Rwanda-Urundi": "Ruanda-Urundi",
    # S
    "Sabah (North Borneo)": "Sabah (Noord-Borneo)",
    "San Marino": "San Marino",
    "Sarawak": "Sarawak",
    "Saudi Arabia": "Saoedi-Arabië",
    "Saxe-Altenburg": "Saksen-Altenburg",
    "Saxe-Coburg-Gotha": "Saksen-Coburg-Gotha",
    "Saxe-Coburg-Saalfeld": "Saksen-Coburg-Saalfeld",
    "Saxe-Gotha-Altenberg": "Saksen-Gotha-Altenburg",
    "Saxe-Hildburgchausen": "Saksen-Hildburghausen",
    "Saxe-Meiningen": "Saksen-Meiningen",
    "Saxe-Weimar": "Saksen-Weimar",
    "Saxony": "Saksen",
    "Schaumburg Lippe": "Schaumburg-Lippe",
    "Selangore": "Selangor",
    "Senegal": "Senegal",
    "Serbia": "Servië",
    "Serbian Residual State": "Rompstaat Servië",
    "Sierra Leone": "Sierra Leone",
    "Singapore": "Singapore",
    "Slovakia": "Slowakije",
    "Slovenia": "Slovenië",
    "Solomon Islands": "Salomonseilanden",
    "Somalia": "Somalië",
    "South Africa": "Zuid-Afrika",
    "South Australia": "Zuid-Australië",
    "South Sudan": "Zuid-Soedan",
    "Southern Nigeria": "Zuid-Nigeria",
    "Southern Sakhalin Island": "Zuid-Sachalin",
    "Southern zone of Spanish Morocco": "Spaans Marokko (zuidzone)",
    "Soviet Union": "Sovjet-Unie",
    "Spain": "Spanje",
    "Spanish Morocco": "Spaans Marokko",
    "Spanish Sahara": "Spaanse Sahara",
    "Spanish West Africa": "Spaans West-Afrika",
    "Sri Lanka (Ceylon)": "Sri Lanka (Ceylon)",
    "Straits Settlements": "Straits Settlements",
    "Sudan": "Soedan",
    "Surinam": "Suriname",
    "Swaziland (Eswatini)": "Swaziland (eSwatini)",
    "Sweden": "Zweden",
    "Switzerland": "Zwitserland",
    "Syria": "Syrië",
    # T
    "Taiwan": "Taiwan",
    "Tajikistan": "Tadzjikistan",
    "Tanzania (Tanganyika)": "Tanzania (Tanganyika)",
    "Tasmania": "Tasmanië",
    "Thailand": "Thailand",
    "Tibet": "Tibet",
    "Togo": "Togo",
    "Transnistria": "Transnistrië",
    "Transvaal": "Transvaal",
    "Trinidad and Tobago": "Trinidad en Tobago",
    "Tunisia": "Tunesië",
    "Turkey": "Turkije",
    "Turkey (Ottoman Empire)": "Turkije (Ottomaans Rijk)",
    "Turkmenistan": "Turkmenistan",
    # U
    "Uganda": "Oeganda",
    "Ukraine": "Oekraïne",
    "Unfederated Malay States": "Ongefedereerde Maleise Staten",
    "United Arab Emirates": "Verenigde Arabische Emiraten",
    "United Kingdom": "Verenigd Koninkrijk",
    "United States of America": "Verenigde Staten",
    "Uruguay": "Uruguay",
    "Uzbekistan": "Oezbekistan",
    # V
    "Vatican": "Vaticaan",
    "Venezuela": "Venezuela",
    "Vichy France": "Vichy-Frankrijk",
    "Victoria": "Victoria",
    "Vietnam (Annam/Cochin China/Tonkin)": "Vietnam",
    "Vietnam, Democratic Republic of": "Noord-Vietnam",
    "Vietnam, Republic of": "Zuid-Vietnam",
    # W
    "Waldeck": "Waldeck",
    "West Bank": "Westelijke Jordaanoever",
    "West Irian (Dutch New Guinea)": "West-Irian (Nederlands Nieuw-Guinea)",
    "Western Australia": "West-Australië",
    "Wolfenbuttel": "Wolfenbüttel",
    "Württemberg": "Württemberg",
    # Y
    "Yemen (Arab Republic of Yemen)": "Jemen",
    "Yemen, People's Republic of": "Zuid-Jemen",
    "Yugoslavia": "Joegoslavië",
    # Z
    "Zambia": "Zambia",
    "Zanzibar": "Zanzibar",
    "Zimbabwe (Rhodesia)": "Zimbabwe (Rhodesië)",
}

def get_nl(name):
    return NL.get(name, name)  # fallback: originele naam

def process_geojson(path, name_key, out_path=None):
    with open(path) as f:
        d = json.load(f)
    for feat in d['features']:
        p = feat['properties']
        eng_name = p.get(name_key, '')
        p['name_nl'] = get_nl(eng_name) if eng_name else ''
    out = out_path or path
    with open(out, 'w') as f:
        json.dump(d, f)
    missing = [feat['properties'].get(name_key,'') for feat in d['features'] if feat['properties'].get(name_key,'') not in NL]
    return len(d['features']), sorted(set(missing))

if __name__ == '__main__':
    repo = sys.argv[1] if len(sys.argv) > 1 else '.'

    print("=== Vertaling toevoegen ===\n")

    # CShapes Wereld
    path = os.path.join(repo, 'cshapes.geojson')
    if os.path.exists(path):
        n, missing = process_geojson(path, 'cntry_name')
        print(f"cshapes.geojson: {n} features verwerkt")
        if missing: print(f"  Ontbrekend: {missing}")

    # CShapes Europa
    path = os.path.join(repo, 'cshapes_europe.geojson')
    if os.path.exists(path):
        n, missing = process_geojson(path, 'Name')
        print(f"cshapes_europe.geojson: {n} features verwerkt")
        if missing: print(f"  Ontbrekend: {missing}")

    # WOII frames
    frames_dir = os.path.join(repo, 'wwii_frames')
    if os.path.exists(frames_dir):
        files = sorted(glob.glob(os.path.join(frames_dir, '*.geojson')))
        all_missing = set()
        for fp in files:
            with open(fp) as f:
                d = json.load(f)
            for feat in d['features']:
                p = feat['properties']
                eng = p.get('name') or p.get('Name', '')
                p['name_nl'] = get_nl(eng) if eng else ''
                if eng and eng not in NL:
                    all_missing.add(eng)
            with open(fp, 'w') as f:
                json.dump(d, f)
        print(f"wwii_frames/: {len(files)} bestanden verwerkt")
        if all_missing: print(f"  Ontbrekend: {sorted(all_missing)}")

    # Historical basemaps
    hist_dir = os.path.join(repo, 'historical_basemaps')
    if os.path.exists(hist_dir):
        files = sorted(glob.glob(os.path.join(hist_dir, '*.geojson')))
        all_missing = set()
        for fp in files:
            with open(fp) as f:
                try:
                    d = json.load(f)
                except:
                    continue
            for feat in d['features']:
                p = feat['properties']
                eng = p.get('NAME') or p.get('Name', '')
                p['name_nl'] = get_nl(eng) if eng else ''
                if eng and eng not in NL:
                    all_missing.add(eng)
            with open(fp, 'w') as f:
                json.dump(d, f)
        print(f"historical_basemaps/: {len(files)} bestanden verwerkt")
        if all_missing: print(f"  Ontbrekend in vertaaltabel (eerste 20): {sorted(all_missing)[:20]}")

    print("\nKlaar!")
