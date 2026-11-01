package main

import (
	"compress/gzip"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// MapInfo is one War Thunder ground-battle map.
// File is the image name on the War Thunder wiki (MapIcon_Ground_*.jpg).
type MapInfo struct {
	Name string `json:"name"`
	File string `json:"file"`
}

// Ground forces maps, from https://wiki.warthunder.com/Ground_Forces_Maps
var mapCatalog = []MapInfo{
	{"38th Parallel", "MapIcon_Ground_Korea.jpg"},
	{"Abandoned Factory", "MapIcon_Ground_AbandonedFactory.jpg"},
	{"Abandoned Town", "MapIcon_Ground_AbandonedTown.jpg"},
	{"Advance to the Rhine", "MapIcon_Ground_AdvancetotheRhine.jpg"},
	{"Alaska", "MapIcon_Ground_Alaska.jpg"},
	{"American Desert", "MapIcon_Ground_AmericanDesert.jpg"},
	{"Aral Sea", "MapIcon_Ground_AralSea.jpg"},
	{"Arctic", "MapIcon_Ground_Arctic.jpg"},
	{"Ardennes", "MapIcon_Ground_Ardennes.jpg"},
	{"Ash River", "MapIcon_Ground_AshRiver.jpg"},
	{"Berlin", "MapIcon_Ground_Berlin.jpg"},
	{"Breslau", "MapIcon_Ground_Breslau.jpg"},
	{"Campania", "MapIcon_Ground_Italy.jpg"},
	{"Cargo Port", "MapIcon_Ground_CargoPort.jpg"},
	{"Carpathians", "MapIcon_Ground_Carpathians.jpg"},
	{"Eastern Europe", "MapIcon_Ground_EasternEurope.jpg"},
	{"El Alamein", "MapIcon_Ground_ElAlamein.jpg"},
	{"European Province", "MapIcon_Ground_EuropeanProvince.jpg"},
	{"Finland", "MapIcon_Ground_Finland.jpg"},
	{"Frozen Pass", "MapIcon_Ground_FrozenPass.jpg"},
	{"Fulda Gap", "MapIcon_Ground_Fulda.jpg"},
	{"Hürtgen Forest", "MapIcon_Ground_HurtgenForest.jpg"},
	{"Japan", "MapIcon_Ground_Japan.jpg"},
	{"Jungle", "MapIcon_Ground_Jungle.jpg"},
	{"Karelia", "MapIcon_Ground_Karelia.jpg"},
	{"Kuban", "MapIcon_Ground_Kuban.jpg"},
	{"Kursk", "MapIcon_Ground_Kursk.jpg"},
	{"Maginot Line", "MapIcon_Ground_MaginotLine.jpg"},
	{"Middle East", "MapIcon_Ground_MiddleEast.jpg"},
	{"Mozdok", "MapIcon_Ground_Mozdok.jpg"},
	{"Normandy", "MapIcon_Ground_Normandy.jpg"},
	{"Fields of Normandy", "MapIcon_Ground_FieldsofNormandy.jpg"},
	{"Poland", "MapIcon_Ground_Poland.jpg"},
	{"Fields of Poland", "MapIcon_Ground_FieldsofPoland.jpg"},
	{"Port Novorossiysk", "MapIcon_Ground_PortNovorossiysk.jpg"},
	{"Pradesh", "MapIcon_Ground_Pradesh.jpg"},
	{"Red Desert", "MapIcon_Ground_RedDesert.jpg"},
	{"Seversk-13", "MapIcon_Ground_Seversk-13.jpg"},
	{"Sinai", "MapIcon_Ground_Sinai.jpg"},
	{"Sands of Sinai", "MapIcon_Ground_SandsofSinai.jpg"},
	{"Spaceport", "MapIcon_Ground_Spaceport.jpg"},
	{"Stalingrad", "MapIcon_Ground_Stalingrad.jpg"},
	{"Sun City", "MapIcon_Ground_SunCity.jpg"},
	{"Sweden", "MapIcon_Ground_Sweden.jpg"},
	{"Tunisia", "MapIcon_Ground_Tunisia.jpg"},
	{"Sands of Tunisia", "MapIcon_Ground_SandsofTunisia.jpg"},
	{"Vietnam Hills", "MapIcon_Ground_VietnamHills.jpg"},
	{"Volokolamsk", "MapIcon_Ground_Volokolamsk.jpg"},
	{"Surroundings of Volokolamsk", "MapIcon_Ground_SurroundingsofVolokolamsk.jpg"},
	{"Wallonia", "MapIcon_Ground_Wallonia.jpg"},
	{"White Rock Fortress", "MapIcon_Ground_WhiteRockFortress.jpg"},
}

var allMaps = func() []string {
	out := make([]string, len(mapCatalog))
	for i, m := range mapCatalog {
		out[i] = m.Name
	}
	return out
}()

var mapFiles = func() map[string]bool {
	out := map[string]bool{}
	for _, m := range mapCatalog {
		out[m.File] = true
	}
	return out
}()

// ---- map images ----
// Order: ./web/maps/<file> (put images there to self-host) -> memory cache -> War Thunder wiki.
// Only names from mapCatalog are served, so this is not an open proxy.

type cachedImg struct {
	data   []byte
	ctype  string
	failed time.Time
}

var imgCache = struct {
	sync.Mutex
	m map[string]*cachedImg
}{m: map[string]*cachedImg{}}

var imgSources = []string{
	"https://wiki.warthunder.com/Special:FilePath/",
	"https://old-wiki.warthunder.com/Special:FilePath/",
}

func fetchMapImage(file string) ([]byte, string) {
	for _, base := range imgSources {
		req, _ := http.NewRequest("GET", base+url.PathEscape(file), nil)
		req.Header.Set("User-Agent", "JASAQ-Activity/8.5 (map thumbnails)")
		resp, err := httpClient.Do(req)
		if err != nil {
			continue
		}
		ctype := resp.Header.Get("Content-Type")
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if resp.StatusCode == 200 && strings.HasPrefix(ctype, "image/") && len(data) > 0 {
			return data, ctype
		}
	}
	return nil, ""
}

func mapImage(w http.ResponseWriter, r *http.Request) {
	file := filepath.Base(r.URL.Path)
	if !mapFiles[file] {
		http.NotFound(w, r)
		return
	}
	local := filepath.Join("web", "maps", file)
	if _, err := os.Stat(local); err == nil {
		w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
		http.ServeFile(w, r, local)
		return
	}
	imgCache.Lock()
	c := imgCache.m[file]
	if c == nil {
		c = &cachedImg{}
		imgCache.m[file] = c
	}
	imgCache.Unlock()
	// one fetch per file at a time; failed fetches are retried after 10 minutes
	imgCache.Lock()
	need := c.data == nil && time.Since(c.failed) > 10*time.Minute
	imgCache.Unlock()
	if need {
		data, ctype := fetchMapImage(file)
		imgCache.Lock()
		if data != nil {
			c.data, c.ctype = data, ctype
		} else {
			c.failed = time.Now()
			log.Printf("map image unavailable: %s", file)
		}
		imgCache.Unlock()
	}
	imgCache.Lock()
	data, ctype := c.data, c.ctype
	imgCache.Unlock()
	if data == nil {
		w.Header().Set("Cache-Control", "no-store")
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
	_, _ = w.Write(data)
}

// ---- static files: gzip + cache headers ----

type gzipWriter struct {
	http.ResponseWriter
	zw *gzip.Writer
}

func (g gzipWriter) Write(b []byte) (int, error) { return g.zw.Write(b) }

var gzPool = sync.Pool{New: func() any { w, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed); return w }}

func staticHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case r.URL.RawQuery != "" && (strings.HasSuffix(p, ".js") || strings.HasSuffix(p, ".css")):
			// versioned (?v=...) assets never change
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case strings.HasSuffix(p, ".jpg") || strings.HasSuffix(p, ".png") || strings.HasSuffix(p, ".webp"):
			w.Header().Set("Cache-Control", "public, max-age=604800")
		default:
			w.Header().Set("Cache-Control", "no-cache")
		}
		compressible := p == "/" || strings.HasSuffix(p, ".html") || strings.HasSuffix(p, ".js") || strings.HasSuffix(p, ".css") || strings.HasSuffix(p, ".svg")
		if !compressible || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			fs.ServeHTTP(w, r)
			return
		}
		// no conditional/range requests on the gzip path (avoids 304/206 with a gzip body)
		r.Header.Del("If-Modified-Since")
		r.Header.Del("If-Range")
		r.Header.Del("Range")
		zw := gzPool.Get().(*gzip.Writer)
		zw.Reset(w)
		defer func() { _ = zw.Close(); gzPool.Put(zw) }()
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		w.Header().Del("Content-Length")
		fs.ServeHTTP(noLength{gzipWriter{w, zw}}, r)
	})
}

// noLength drops Content-Length set by FileServer (it is the uncompressed size).
type noLength struct{ gzipWriter }

func (n noLength) WriteHeader(code int) {
	n.ResponseWriter.Header().Del("Content-Length")
	n.ResponseWriter.WriteHeader(code)
}
