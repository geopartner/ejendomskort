if (!String.prototype.padStart) {
    String.prototype.padStart = function padStart(targetLength, padString) {
        targetLength = targetLength >> 0; //floor if number or convert non-number to 0;
        padString = String(padString || ' ');
        if (this.length > targetLength) {
            return String(this);
        }
        else {
            targetLength = targetLength - this.length;
            if (targetLength > padString.length) {
                padString += padString.repeat(targetLength / padString.length); //append to original to ensure we are longer than needed
            }
            return padString.slice(0, targetLength) + String(this);
        }
    };
}
function isXY(list) {
    return list.length >= 2 &&
        typeof list[0] === 'number' &&
        typeof list[1] === 'number';
}

function traverseCoords(coordinates, callback) {
    if (isXY(coordinates)) return callback(coordinates);
    return coordinates.map(function (coord) { return traverseCoords(coord, callback); });
}

// Simplistic shallow clone that will work for a normal GeoJSON object.
function clone(obj) {
    if (null == obj || 'object' !== typeof obj) return obj;
    var copy = obj.constructor();
    for (var attr in obj) {
        if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
    }
    return copy;
}

function traverseGeoJson(geojson, leafCallback, nodeCallback) {
    if (geojson == null) return geojson;

    var r = clone(geojson);

    if (geojson.type === 'Feature') {
        r.geometry = traverseGeoJson(geojson.geometry, leafCallback, nodeCallback);
    } else if (geojson.type === 'FeatureCollection') {
        r.features = r.features.map(function (gj) { return traverseGeoJson(gj, leafCallback, nodeCallback); });
    } else if (geojson.type === 'GeometryCollection') {
        r.geometries = r.geometries.map(function (gj) { return traverseGeoJson(gj, leafCallback, nodeCallback); });
    } else {
        if (leafCallback) leafCallback(r);
    }

    if (nodeCallback) nodeCallback(r);

    return r;
}

function detectCrs(geojson, projs) {
    var crsInfo = geojson.crs,
        crs;

    if (crsInfo === undefined) {
        throw new Error('Unable to detect CRS, GeoJSON has no "crs" property.');
    }

    if (crsInfo.type === 'name') {
        crs = projs[crsInfo.properties.name];
    } else if (crsInfo.type === 'EPSG') {
        crs = projs['EPSG:' + crsInfo.properties.code];
    }

    if (!crs) {
        throw new Error('CRS defined in crs section could not be identified: ' + JSON.stringify(crsInfo));
    }

    return crs;
}

function determineCrs(crs, projs) {
    if (typeof crs === 'string' || crs instanceof String) {
        return projs[crs] || proj4.Proj(crs);
    }

    return crs;
}

function reproject(geojson, from, to, projs) {
    projs = projs || {};
    if (!from) {
        from = detectCrs(geojson, projs);
    } else {
        from = determineCrs(from, projs);
    }

    to = determineCrs(to, projs);
    var transform = proj4(from, to);

    return traverseGeoJson(geojson, function (gj) {
        // No easy way to put correct CRS info into the GeoJSON,
        // and definitely wrong to keep the old, so delete it.
        if (gj.crs) {
            delete gj.crs;
        }
        gj.coordinates = traverseCoords(gj.coordinates, function (xy) {
            return transform.forward(xy);
        });
    }, function (gj) {
        if (gj.bbox) {
            // A bbox can't easily be reprojected, just reprojecting
            // the min/max coords definitely will not work since
            // the transform is not linear (in the general case).
            // Workaround is to just re-compute the bbox after the
            // transform.
            gj.bbox = (function () {
                var min = [Number.MAX_VALUE, Number.MAX_VALUE],
                    max = [-Number.MAX_VALUE, -Number.MAX_VALUE];
                traverseGeoJson(gj, function (_gj) {
                    traverseCoords(_gj.coordinates, function (xy) {
                        min[0] = Math.min(min[0], xy[0]);
                        min[1] = Math.min(min[1], xy[1]);
                        max[0] = Math.max(max[0], xy[0]);
                        max[1] = Math.max(max[1], xy[1]);
                    });
                });
                return [min[0], min[1], max[0], max[1]];
            })();
        }
    });
}
var transform = proj4('+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs', 'EPSG:4326');
var utm32 = proj4('+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs');
var wgs84 = proj4('EPSG:4326');
mapboxgl.accessToken = 'pk.eyJ1IjoicnVuZXR2aWx1bSIsImEiOiJkeUg2WVkwIn0.yoMmv3etOc40RXkPsebXSg';

/*var progressbar = $("#progressbar"),
    progressLabel = $(".progress-label");
progressbar.progressbar({
    value: false,
    change: function () {
        progressLabel.text(progressbar.progressbar("value") + "%");
    },
    complete: function () {
        progressLabel.text("Complete!");
        progressbar.hide();
    }
});*/


var queue = [];
var columns = [];
var geojson = {
    type: "FeatureCollection",
    features: []
};

var map = new mapboxgl.Map({
    maxZoom: 22,
    container: 'map', // container id
    style: 'mapbox://styles/mapbox/light-v8', //stylesheet location
    //style: 'mapbox://styles/mapbox/satellite-v8',
    center: [11, 56], // starting position
    zoom: 7 // starting zoom
});
map.on('load', function () {
    $('.modal').modal('show');

    /*
    map.addLayer({
        'id': '3d-buildings',
        'source': 'composite',
        'source-layer': 'building',
        'filter': ['==', 'extrude', 'true'],
        'type': 'fill-extrusion',
        'minzoom': 15,
        'paint': {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': {
                'type': 'identity',
                'property': 'height'
            },
            'fill-extrusion-base': {
                'type': 'identity',
                'property': 'min_height'
            },
            'fill-extrusion-opacity': .6
        }
    });
    */
    var style = map.getStyle();
    for (var n = 0; n < style.layers.length; n++) {
        var layer = style.layers[n];
        if (layer.hasOwnProperty('layout') && layer.layout.hasOwnProperty('text-field') && layer.layout['text-field'] === '{name_en}') {
            map.setLayoutProperty(layer.id, 'text-field', '{name}');
        }
    }
    /*map.addSource('ejerlav', {
        "type": "vector",        
        "tiles": ["http://192.168.1.10:8080/geoserver/gwc/service/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&LAYER=geopartner:ejerlav&STYLE=&TILEMATRIX=EPSG:900913:{z}&TILEMATRIXSET=EPSG:900913&FORMAT=application/x-protobuf;type=mapbox-vector&TILECOL={x}&TILEROW={y}"]
    });
    map.addLayer({
        'id': 'Ejerlav',
        'type': 'fill',
        'source': 'ejerlav',
        'source-layer': 'ejerlav',
        'paint': {
            'fill-color': '#f00',
            'fill-opacity': 0.5
        }
    });
    map.addSource('matrikelskel', {
        "type": "vector",        
        "tiles": ["http://192.168.1.10:8080/geoserver/gwc/service/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&LAYER=geopartner:matrikelskel&STYLE=&TILEMATRIX=EPSG:900913:{z}&TILEMATRIXSET=EPSG:900913&FORMAT=application/x-protobuf;type=mapbox-vector&TILECOL={x}&TILEROW={y}"],
        'minzoom': 14
    });
    map.addSource('centroide', {
        "type": "vector",        
        "tiles": ["http://192.168.1.10:8080/geoserver/gwc/service/wmts?REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&LAYER=geopartner:centroide&STYLE=&TILEMATRIX=EPSG:900913:{z}&TILEMATRIXSET=EPSG:900913&FORMAT=application/x-protobuf;type=mapbox-vector&TILECOL={x}&TILEROW={y}"],
        'minzoom': 16
    });
    map.addLayer({
        'id': 'Matrikelskel',
        'type': 'line',
        'source': 'matrikelskel',
        'source-layer': 'matrikelskel',
        'paint': {
            'line-color': '#000',
        }
    });
    map.addLayer({
        'id': 'Matrikelnummer',
        'type': 'symbol',
        'source': 'centroide',
        'source-layer': 'centroide',
        'layout': {
            'text-field': '{matrikelnummer}',
            'text-font': [
                'DIN Offc Pro Medium',
                'Arial Unicode MS Bold'
            ],
            'text-size': 12
        },
        'paint': {
            'text-color': '#000'
        }
    })*/
    map.addSource('csv', {
        type: 'geojson',
        data: geojson
    });
    map.addLayer({
        'id': 'Aktuel',
        'type': 'fill',
        'source': 'csv',
        'paint': {
            'fill-color': {
                property: 'aktuel',
                stops: [
                    [0, '#F2F12D'],
                    [500000, '#EED322'],
                    [750000, '#E6B71E'],
                    [1000000, '#DA9C20'],
                    [2500000, '#CA8323'],
                    [5000000, '#B86B25'],
                    [7500000, '#A25626'],
                    [10000000, '#8B4225'],
                    [25000000, '#723122']
                ]
            },
            'fill-opacity': 0.75
        },
        'layout': {
            'visibility': 'visible'
        }
    });
    map.addLayer({
        'id': 'Historisk',
        'type': 'fill',
        'source': 'csv',
        'paint': {
            'fill-color': {
                property: 'historisk',
                stops: [
                    [0, '#F2F12D'],
                    [500000, '#EED322'],
                    [750000, '#E6B71E'],
                    [1000000, '#DA9C20'],
                    [2500000, '#CA8323'],
                    [5000000, '#B86B25'],
                    [7500000, '#A25626'],
                    [10000000, '#8B4225'],
                    [25000000, '#723122']
                ]
            },
            'fill-opacity': 0.75
        },
        'layout': {
            'visibility': 'none'
        }
    });
    /*
    map.addLayer({
        'id': 'aktuel-3d',
        'type': 'fill-extrusion',
        'minzoom': 15,
        'source': 'csv',
        'paint': {
            'fill-extrusion-color': '#F44336',
            'fill-extrusion-height': {
                'type': 'identity',
                'property': 'aktuel_height'
            },
            'fill-extrusion-base': {
                'type': 'identity',
                'property': 'aktuel_min_height'
            },
            'fill-extrusion-opacity': .6
        }
    });
    map.addLayer({
        'id': 'historisk-3d',
        'type': 'fill-extrusion',
        'minzoom': 15,
        'source': 'csv',
        'paint': {
            'fill-extrusion-color': '#2196F3',
            'fill-extrusion-height': {
                'type': 'identity',
                'property': 'historisk_height'
            },
            'fill-extrusion-base': {
                'type': 'identity',
                'property': 'historisk_min_height'
            },
            'fill-extrusion-opacity': .6
        }
    });
*/

    map.addLayer({
        'id': 'Historisk-label',
        'type': 'symbol',
        'source': 'csv',
        'layout': {
            'text-field': '{historisk_locale}',
            'text-font': [
                'DIN Offc Pro Medium',
                'Arial Unicode MS Bold'
            ],
            'text-size': 12
        },
        'paint': {
            'text-color': '#000'
        }
    })
    map.addLayer({
        'id': 'Aktuel-label',
        'type': 'symbol',
        'source': 'csv',
        'layout': {
            'visibility': 'none',
            'text-field': '{aktuel_locale}',
            'text-font': [
                'DIN Offc Pro Medium',
                'Arial Unicode MS Bold'
            ],
            'text-size': 12
        },
        'paint': {
            'text-color': '#000'
        }
    })
    map.on('click', function (e) {
        var features = map.queryRenderedFeatures(e.point, { layers: ['Aktuel', 'Historisk'] });

        if (!features.length) {
            return;
        }

        var feature = features[0];
        var html = "<table>";
        for (var key in feature.properties) {
            if (feature.properties[key]) {
                html += "<tr><td>" + key + "</td><td>" + feature.properties[key] + "</td></tr>";
            }
        }
        html += "</table>";
        // Populate the popup and set its coordinates
        // based on the feature found.
        var popup = new mapboxgl.Popup({ anchor: 'bottom' })
            .setLngLat(e.lngLat)
            .setHTML(html)
            .addTo(map);
    });

    // Use the same approach as above to indicate that the symbols are clickable
    // by changing the cursor style to 'pointer'.
    map.on('mousemove', function (e) {
        var features = map.queryRenderedFeatures(e.point, { layers: ['Aktuel', 'Historisk'] });
        map.getCanvas().style.cursor = (features.length) ? 'pointer' : '';
    });
    var toggleableLayerIds = ['Aktuel', 'Historisk'];
    var links = {}
    for (var i = 0; i < toggleableLayerIds.length; i++) {
        var id = toggleableLayerIds[i];

        var link = document.createElement('a');
        link.href = '#';
        link.className = 'active';
        link.textContent = id;
        links[id] = link;
        var visibility = map.getLayoutProperty(id, 'visibility');

        if (visibility === 'visible') {
            link.className = 'active';
        } else {
            link.className = '';
        }

        link.onclick = function (e) {
            // var clickedLayer = this.textContent;
            e.preventDefault();
            e.stopPropagation();
            for (var i = 0; i < toggleableLayerIds.length; i++) {
                var id = toggleableLayerIds[i];
                var visibility = map.getLayoutProperty(id, 'visibility');

                if (visibility === 'visible') {
                    map.setLayoutProperty(id, 'visibility', 'none');
                    map.setLayoutProperty(id + '-label', 'visibility', 'none');
                    links[id].className = '';
                } else {
                    links[id].className = 'active';
                    map.setLayoutProperty(id, 'visibility', 'visible');
                    map.setLayoutProperty(id + '-label', 'visibility', 'visible');
                }
            }
        };

        var layers = document.getElementById('menu');
        layers.appendChild(link);
    }

});
var index = {};
var bbox = [[100, 100], [0, 0]];
var max = 0;
function doWork() {
    var v = parseInt(100 * (max - queue.length) / max)
    $('.progress-bar').css('width', v + '%').attr('aria-valuenow', v).text(v + '%');

    if (queue.length > 0) {
        var properties = queue.pop();
        if (properties[columns[4]] && properties[columns[5]]) {
            /*
            var ejerlav = properties[columns[25]];
            var matrnr = properties[columns[26]]
            */
            var kommunenr = properties[columns[4]];
            var ejdnr = properties[columns[5]];
            var esrejdnr = kommunenr + ejdnr.padStart(7, '0');
            /*
            if (!index.hasOwnProperty(ejerlav)) {
                index[ejerlav] = {};
            }
            */
            //if (!index[ejerlav].hasOwnProperty(matrnr)) {
            if (!index.hasOwnProperty(esrejdnr)) {
                //index[ejerlav][matrnr] = true;
                index[esrejdnr] = true;
                //$.getJSON("https://services.kortforsyningen.dk/?login=runetvilum&password=rutv2327&outgeoref=EPSG:4326&servicename=RestGeokeys_v2&method=matrikelnr&ejkode=" + properties[columns[25]] + "&matnr=" + properties[columns[26]] + "&geometry=true", function (data) {
                $.getJSON("https://services.kortforsyningen.dk/?login=runetvilum&password=rutv2327&servicename=RestGeokeys_v2&method=esrejendom&esrejdnr=" + esrejdnr + "&geometry=true", function (data) {
                    if (data.features) {
                        $('#status').append('<tr><td>' + esrejdnr + '</td><td>OK</td><td>' + data.features.length + '</td></tr>');
                        for (var n = 0; n < data.features.length; n++) {
                            var feature1 = data.features[n];
                            var feature = reproject(feature1, utm32, wgs84);
                            if (bbox[0][0] > feature.bbox[0]) {
                                bbox[0][0] = feature.bbox[0];
                            }
                            if (bbox[0][1] > feature.bbox[1]) {
                                bbox[0][1] = feature.bbox[1];
                            }
                            if (bbox[1][0] < feature.bbox[2]) {
                                bbox[1][0] = feature.bbox[2];
                            }
                            if (bbox[1][1] < feature.bbox[3]) {
                                bbox[1][1] = feature.bbox[3];
                            }
                            feature.properties = properties;
                            geojson.features.push(feature);
                        }
                    } else {
                        $('#status').append('<tr class="danger"><td>' + esrejdnr + '</td><td>Fejl</td><td>0</td></tr>');
                    }
                    doWork();
                });
            } else {
                doWork();
            }
        } else {
            doWork();
        }
    } else {
        var source = map.getSource('csv');
        source.setData(geojson);
        map.fitBounds(bbox);
    }
}
function handleFileSelect(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    $('.modal').modal('show');
    $('#status').html('');
    var files = evt.dataTransfer.files; // FileList object.
    for (var file = 0, f; f = files[file]; file++) {
        var reader = new FileReader();

        // Closure to capture the file information.
        reader.onload = (function (theFile) {
            return function (e) {
                var lines = this.result.split('\n');
                var observations = [];
                geojson = {
                    type: "FeatureCollection",
                    features: []
                };
                index = {};
                for (var j = 0; j < lines.length; j++) {
                    var linenum = j;
                    var data = lines[j].split(';');
                    if (j === 0) {
                        columns = data;
                    } else {
                        var properties = {};
                        for (var n = 0; n < data.length; n++) {
                            properties[columns[n]] = data[n];
                        }
                        properties.aktuel_min_height = 0;
                        properties.aktuel_height = 0;
                        properties.historisk_min_height = 0;
                        properties.historisk_height = 0;
                        var aktuel = 0, historisk = 0;
                        if (properties.hasOwnProperty(columns[17])) {
                            historisk = parseInt(properties[columns[17]].replace('.',''))
                            properties.historisk_height = historisk / 100000;
                        }
                        if (properties.hasOwnProperty(columns[12])) {
                            aktuel = parseInt(properties[columns[12]].replace('.',''))
                            properties.aktuel_height = aktuel / 100000;
                        }
                        if (aktuel < historisk) {
                            properties.historisk_min_height = properties.aktuel_height;
                            properties.aktuel_min_height = 0;
                        } else {
                            properties.historisk_min_height = 0;
                            properties.aktuel_min_height = properties.historisk_height;
                        }
                        properties.aktuel_locale = aktuel.toLocaleString('da-DK') + ' kr.';
                        properties.historisk_locale = historisk.toLocaleString('da-DK') + ' kr.';
                        properties.aktuel = aktuel;
                        properties.historisk = historisk;

                        queue.push(properties);
                    }

                }
                max = queue.length;
                doWork();
            };
        })(f);

        // Read in the image file as a data URL.
        reader.readAsText(f);

    }
}

function handleDragOver(evt) {
    evt.stopPropagation();
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
}
window.addEventListener('load', function () {
    var dropZone = document.body; // document.getElementById('map');
    dropZone.addEventListener('dragover', handleDragOver, false);
    dropZone.addEventListener('drop', handleFileSelect, false);
});




    // Setup the dnd listeners.
