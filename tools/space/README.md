# Spaces data

Builds `site/space/spaces.json` and `site/space/basemap.json` for the Spaces page (`/space/`). It runs by hand, not in the daily build: it needs Python and a browser, and its inputs change slowly. Run it again every month or two, or after a round of adding hours to OpenStreetMap.

You need Python 3.11 or newer with `pip install osmium shapely`, Node 20 or newer with `npm install` in this folder, and a Chromium for the hours reader (set `CHROME_PATH`).

```bash
W=/tmp/space && mkdir -p $W/dl/sites $W/work

# 1. Inputs: OpenStreetMap for San Francisco, and four DataSF tables
curl -L -o $W/dl/sf.osm.pbf https://download.bbbike.org/osm/bbbike/SanFrancisco/SanFrancisco.osm.pbf
curl -G -o $W/dl/nhoods.geojson https://data.sf.gov/resource/j2bu-swwd.geojson \
  --data-urlencode "\$where=nhood in ('Inner Sunset','Sunset/Parkside')"
curl -G -o $W/dl/assessor.json https://data.sf.gov/resource/wv5m-vpq2.json \
  --data-urlencode "\$where=closed_roll_year='2025' AND analysis_neighborhood in ('Inner Sunset','Sunset/Parkside') AND use_definition != 'Single Family Residential'" \
  --data-urlencode '$select=parcel_number,block,lot,property_location,use_definition,property_class_code_definition,number_of_stories,number_of_units,zoning_code,property_area,basement_area,lot_area,year_property_built,analysis_neighborhood,the_geom' \
  --data-urlencode '$limit=50000'
curl -G -o $W/dl/parcels.json https://data.sf.gov/resource/acdm-wktn.json \
  --data-urlencode "\$where=active=true AND within_box(shape, 37.768, -122.514, 37.727, -122.444)" \
  --data-urlencode '$select=blklot,from_address_num,to_address_num,street_name,street_type,zoning_code,shape' \
  --data-urlencode '$limit=60000'
curl -G -o $W/dl/biz.json https://data.sf.gov/resource/g8m3-pdis.json \
  --data-urlencode "\$where=location_end_date IS NULL AND neighborhoods_analysis_boundaries in ('Inner Sunset','Sunset/Parkside')" \
  --data-urlencode '$select=ttxid,dba_name,ownership_name,full_business_address,dba_start_date,location_start_date,self_reported_naics_code,lic_code_description,location,neighborhoods_analysis_boundaries,business_corridor,administratively_closed' \
  --data-urlencode '$limit=20000'

# 2. Storefronts and building footprints, then the street map
python3 extract_osm.py $W/dl/sf.osm.pbf $W/dl/nhoods.geojson $W/work/osm.json
python3 basemap.py $W/dl/sf.osm.pbf $W/dl/nhoods.geojson $W/work/basemap.json

# 3. Match each storefront to its lot, estimate floor space, read posted hours
python3 build.py $W

# 4. Drop chains, read hours from business websites, merge them in
python3 finalize.py $W prep
node scrape_hours.js $W/work/scrape_in.json $W/dl/sites/scraped.json 4
python3 finalize.py $W merge

# 5. Write the page data
python3 finalize.py $W export ../../site/space
```

## What each step does

- `extract_osm.py` keeps named shops, restaurants, offices and services inside the Inner Sunset and Sunset/Parkside outlines, with their posted hours, and every building footprint nearby.
- `build.py` matches each storefront to its lot (by street address, then by location), reads the building's area, stories and homes from the Assessor's roll, and estimates the ground floor: area divided by stories, checked against the footprint, less 15% for walls and stairs, split among the businesses on the lot. It marks an estimate "good" when the roll and the footprint agree and no more than two businesses share the floor. It also turns each place's hours into a week of half-hour slots (`eval_hours.js`).
- `finalize.py prep` drops chains, banks and gas stations (the list is `CHAIN_NAMES` at the top of the file) and lists the places with a website but no hours.
- `scrape_hours.js` opens each of those websites in headless Chromium, checks `robots.txt` first, and reads hours from schema.org markup or the page text (`hours_parse.js`; `node test_parse.js` runs its cases). Hours read this way are labeled on the page as coming from the business's website.
- `finalize.py export` writes the public files. Places found only in the city's business registry are left out, since a registration can name a person at a home address.

## Finding hours for places that have none

Most storefronts have no hours in OpenStreetMap, and the first pass above only reads the websites OpenStreetMap links. This second pass finds more websites and reads them more closely. It works on the published `spaces.json`, so it needs neither the downloads nor a rebuild, and it only adds hours to places that have none.

```bash
W=/tmp/hours && mkdir -p $W
pip install duckdb && npm install

# 1. Where each place might post its hours: every OpenStreetMap contact tag, plus the
#    matching place in Overture Maps (same name within 40 to 150 m), which lists websites
#    for many shops OpenStreetMap has none for
python3 find_candidates.py ../../site/space/spaces.json $W/candidates.json

# 2. For places still without a website: a DuckDuckGo search, kept only when the result's
#    domain contains the place's own name
python3 search_sites.py $W/candidates.json $W/candidates_search.json

# 3. Read the sites (about 45 minutes for 330 places at 6 at a time)
node find_hours.js $W/candidates.json $W/found.json 6
node find_hours.js $W/candidates_search.json $W/found.json 6

# 4. Write the confirmed hours into the page data, then check the page
node apply_hours.js $W/found.json ../../site/space/spaces.json
```

`find_hours.js` reads, in order: Squarespace's built-in business hours, schema.org JSON-LD and microdata, any weekly schedule in the JSON the site loads for itself (Square Online, Toast and Wix keep hours this way and draw them with script), then the page text, looking first right after the place's own address on sites that list several locations. It follows link-in-bio pages, online ordering links and up to four hours, visit, contact or location pages; checks robots.txt on every site; and records how it knows the page is about this place: the street address or phone number is on the site, a location page's address names the street, or OpenStreetMap linked it. Hours matched only by name are kept as `unverified` in `found.json` and never applied, which is what kept a doughnut chain's hours off a local donut shop. Rerun step 3 with `--retry` after improving a reader to try again the places it found nothing for; `node test_parse.js` runs the reader's cases. For a full rebuild, copy `found.json` to `dl/sites/found.json` and `finalize.py merge` picks it up.

