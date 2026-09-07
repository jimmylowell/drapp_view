/* Where each DRAPP year comes from. Verified 2026-09-07; see README for the
   inventory. `stream` is an ArcGIS ImageServer that renders any bbox region-wide.
   `archive` says what the raw tiles on DRCOG's S3 bucket are:
     'tif'  GeoTIFF the browser can window into (uncompressed strips or tiles)
     'jp2'  JPEG 2000 — download only in this version
     'sid'  MrSID — download only (no open decoder exists)
     null   not published yet (current imagery is sold by Sanborn) */
(function () {
  const SANBORN = 'https://drcog-data.sanborn.com/arcgis/rest/services/';
  const INDEX = 'https://gis.drcog.org/server/rest/services/RDC/TIFF_{Y}_INDEX/MapServer/0';

  const SOURCES = {
    2024: { stream: SANBORN + 'DRCOG_2024/DRCOG_Final_Ortho_2024/ImageServer', archive: null },
    2022: { stream: SANBORN + 'DRCOG_2022/Mosaics_2022/ImageServer', archive: 'tif' },
    2020: { stream: SANBORN + 'DRCOG_2020/Orthos_3in_6in_12in/ImageServer', archive: 'tif' },
    2018: { stream: SANBORN + 'DRCOG_2018/Orthos_3in_6in_12in/ImageServer', archive: 'tif' },
    2016: { archive: 'tif' },
    2014: { archive: 'tif' },
    2012: { archive: 'tif' },
    2010: { archive: 'tif' },
    2008: { archive: 'sid' },
    2006: { archive: 'tif' },
    2004: { archive: 'tif' },
    2002: { archive: 'jp2' },
  };
  const YEARS = Object.keys(SOURCES).map(Number).sort((a, b) => a - b);

  const STREAM_LABEL = 'DRCOG mosaic hosted by Sanborn';
  const ARCHIVE_LABEL = 'DRCOG archive tile on S3, read in the browser';

  window.DRAPP = Object.assign(window.DRAPP || {}, {
    sources: { SOURCES, YEARS, INDEX, STREAM_LABEL, ARCHIVE_LABEL },
  });
})();
