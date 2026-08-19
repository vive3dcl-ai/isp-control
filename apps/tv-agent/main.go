package main

import (
	_ "embed"
	"flag"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/isp-control/tv-agent/internal/api"
	"github.com/isp-control/tv-agent/internal/store"
)

//go:embed VERSION
var versionRaw string

func agentVersion() string {
	return strings.TrimSpace(versionRaw)
}

func main() {
	dataDir := flag.String("data-dir", envOr("ISP_TV_DATA_DIR", "/var/lib/isp-tv"), "data directory")
	listen := flag.String("listen", envOr("ISP_TV_LISTEN", ":8099"), "HTTP listen address")
	tokenFile := flag.String("token-file", "", "API token file (default: <data-dir>/api.token)")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o750); err != nil {
		log.Fatalf("data-dir: %v", err)
	}
	logos := filepath.Join(*dataDir, "logos")
	runDir := filepath.Join(*dataDir, "run")
	_ = os.MkdirAll(logos, 0o750)
	_ = os.MkdirAll(runDir, 0o750)

	tf := *tokenFile
	if tf == "" {
		tf = filepath.Join(*dataDir, "api.token")
	}

	st, err := store.Open(filepath.Join(*dataDir, "data.db"))
	if err != nil {
		log.Fatalf("store: %v", err)
	}
	defer st.Close()

	ver := agentVersion()
	srv := api.New(api.Config{
		Version:   ver,
		DataDir:   *dataDir,
		LogosDir:  logos,
		RunDir:    runDir,
		TokenFile: tf,
		Store:     st,
	})

	log.Printf("isp-tv-agent %s listening on %s (data=%s)", ver, *listen, *dataDir)
	if err := srv.ListenAndServe(*listen); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
