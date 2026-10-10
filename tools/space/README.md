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
