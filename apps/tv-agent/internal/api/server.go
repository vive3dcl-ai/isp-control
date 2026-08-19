package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/isp-control/tv-agent/internal/epg"
	"github.com/isp-control/tv-agent/internal/ffmpegstats"
	"github.com/isp-control/tv-agent/internal/metrics"
	"github.com/isp-control/tv-agent/internal/store"
	"github.com/isp-control/tv-agent/internal/systemd"
)

type Config struct {
	Version   string
	DataDir   string
	LogosDir  string
	RunDir    string
	TokenFile string
	Store     *store.Store
}

type Server struct {
	cfg   Config
	token string
	mux   *http.ServeMux
}

func New(cfg Config) *Server {
	s := &Server{cfg: cfg, mux: http.NewServeMux()}
	s.token = s.loadOrCreateToken()
	s.routes()
	return s
}

func (s *Server) ListenAndServe(addr string) error {
	return http.ListenAndServe(addr, s.mux)
}

func (s *Server) loadOrCreateToken() string {
	b, err := os.ReadFile(s.cfg.TokenFile)
	if err == nil {
		tok := strings.TrimSpace(string(b))
		if tok != "" {
			return tok
		}
	}
	tok := generateToken()
	_ = os.WriteFile(s.cfg.TokenFile, []byte(tok+"\n"), 0o600)
	return tok
}

func generateToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /v1/health", s.withAuth(s.handleHealth))
	s.mux.HandleFunc("GET /v1/host", s.withAuth(s.handleHost))
	s.mux.HandleFunc("GET /v1/categories", s.withAuth(s.handleListCategories))
	s.mux.HandleFunc("POST /v1/categories", s.withAuth(s.handleCreateCategory))
	s.mux.HandleFunc("DELETE /v1/categories/{id}", s.withAuth(s.handleDeleteCategory))
	s.mux.HandleFunc("GET /v1/channels", s.withAuth(s.handleListChannels))
	s.mux.HandleFunc("POST /v1/channels", s.withAuth(s.handleCreateChannel))
	s.mux.HandleFunc("PATCH /v1/channels/{id}", s.withAuth(s.handlePatchChannel))
	s.mux.HandleFunc("DELETE /v1/channels/{id}", s.withAuth(s.handleDeleteChannel))
	s.mux.HandleFunc("POST /v1/channels/{id}/start", s.withAuth(s.handleStartChannel))
	s.mux.HandleFunc("POST /v1/channels/{id}/stop", s.withAuth(s.handleStopChannel))
	s.mux.HandleFunc("GET /v1/channels/{id}/status", s.withAuth(s.handleChannelStatus))
	s.mux.HandleFunc("POST /v1/maintenance/repair-channels", s.withAuth(s.handleRepairChannels))
	s.mux.HandleFunc("POST /v1/channels/{id}/logo", s.withAuth(s.handleUploadLogo))
	s.mux.HandleFunc("GET /v1/logos/{id}", s.withAuth(s.handleGetLogo))
	s.mux.HandleFunc("GET /v1/epg/providers", s.withAuth(s.handleListEpg))
	s.mux.HandleFunc("POST /v1/epg/providers", s.withAuth(s.handleCreateEpg))
	s.mux.HandleFunc("PATCH /v1/epg/providers/{id}", s.withAuth(s.handlePatchEpg))
	s.mux.HandleFunc("DELETE /v1/epg/providers/{id}", s.withAuth(s.handleDeleteEpg))
	s.mux.HandleFunc("POST /v1/epg/providers/{id}/refresh", s.withAuth(s.handleRefreshEpg))
	s.mux.HandleFunc("GET /v1/epg/providers/{id}/channels", s.withAuth(s.handleListEpgChannels))
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") || strings.TrimPrefix(auth, "Bearer ") != s.token {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, map[string]any{
		"ok":      true,
		"version": s.cfg.Version,
		"time":    time.Now().UTC(),
	})
}

func (s *Server) handleHost(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, 200, metrics.Collect())
}

func (s *Server) handleListCategories(w http.ResponseWriter, _ *http.Request) {
	list, err := s.cfg.Store.ListCategories()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"categories": list})
}

func (s *Server) handleCreateCategory(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil || strings.TrimSpace(body.Name) == "" {
		writeErr(w, 400, "name required")
		return
	}
	c, err := s.cfg.Store.CreateCategory(newID(), strings.TrimSpace(body.Name))
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, c)
}

func (s *Server) handleDeleteCategory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.cfg.Store.DeleteCategory(id); err != nil {
		writeErr(w, 404, "not found")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

type channelBody struct {
	Name          string   `json:"name"`
	CategoryID    *string  `json:"categoryId"`
	Source        string   `json:"source"`
	Sources       []string `json:"sources"`
	Output        string   `json:"output"`
	EpgProviderID *string  `json:"epgProviderId"`
	EpgChannelKey *string  `json:"epgChannelKey"`
}

func resolveChannelSources(body channelBody) []string {
	return store.NormalizeSources(body.Source, body.Sources)
}

func (s *Server) handleListChannels(w http.ResponseWriter, _ *http.Request) {
	list, err := s.cfg.Store.ListChannels()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	enriched := make([]map[string]any, 0, len(list))
	for _, ch := range list {
		st := s.channelStatusMap(ch)
		row := map[string]any{
			"channel": ch,
			"status":  st,
		}
		enriched = append(enriched, row)
	}
	writeJSON(w, 200, map[string]any{"channels": enriched})
}

func (s *Server) handleCreateChannel(w http.ResponseWriter, r *http.Request) {
	var body channelBody
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	name := strings.TrimSpace(body.Name)
	sources := resolveChannelSources(body)
	output := strings.TrimSpace(body.Output)
	if name == "" || len(sources) == 0 || output == "" {
		writeErr(w, 400, "name, source(s) and output required")
		return
	}
	id := newID()
	ch := store.Channel{
		ID:            id,
		Name:          name,
		CategoryID:    body.CategoryID,
		Source:        sources[0],
		Sources:       sources,
		Output:        output,
		EpgProviderID: body.EpgProviderID,
		EpgChannelKey: body.EpgChannelKey,
		CreatedAt:     time.Now().UTC(),
	}
	if err := s.cfg.Store.UpsertChannel(ch); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	progress := filepath.Join(s.cfg.RunDir, id+".progress")
	if err := systemd.WriteChannelUnit(id, sources, output, progress); err != nil {
		// Persist channel even if systemd fails (dev / no root); report warning.
		got, _ := s.cfg.Store.GetChannel(id)
		writeJSON(w, 201, map[string]any{"channel": got, "warning": err.Error()})
		return
	}
	_ = systemd.Enable(systemd.ChannelUnitName(id))
	got, _ := s.cfg.Store.GetChannel(id)
	writeJSON(w, 201, map[string]any{"channel": got})
}

func (s *Server) handlePatchChannel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cur, err := s.cfg.Store.GetChannel(id)
	if err != nil || cur == nil {
		writeErr(w, 404, "not found")
		return
	}
	var body channelBody
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if strings.TrimSpace(body.Name) != "" {
		cur.Name = strings.TrimSpace(body.Name)
	}
	if body.CategoryID != nil {
		cur.CategoryID = body.CategoryID
	}
	if body.Sources != nil {
		src := store.NormalizeSources("", body.Sources)
		if len(src) == 0 {
			writeErr(w, 400, "at least one source required")
			return
		}
		cur.Sources = src
		cur.Source = src[0]
	} else if strings.TrimSpace(body.Source) != "" {
		primary := strings.TrimSpace(body.Source)
		if len(cur.Sources) == 0 {
			cur.Sources = []string{primary}
		} else {
			cur.Sources[0] = primary
			cur.Sources = store.NormalizeSources(primary, cur.Sources)
		}
		cur.Source = cur.Sources[0]
	}
	if strings.TrimSpace(body.Output) != "" {
		cur.Output = strings.TrimSpace(body.Output)
	}
	if body.EpgProviderID != nil {
		cur.EpgProviderID = body.EpgProviderID
	}
	if body.EpgChannelKey != nil {
		cur.EpgChannelKey = body.EpgChannelKey
	}
	if err := s.cfg.Store.UpsertChannel(*cur); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	progress := filepath.Join(s.cfg.RunDir, id+".progress")
	_ = systemd.WriteChannelUnit(id, cur.Sources, cur.Output, progress)
	got, _ := s.cfg.Store.GetChannel(id)
	writeJSON(w, 200, map[string]any{"channel": got})
}

func (s *Server) handleDeleteChannel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	_ = systemd.RemoveChannelUnit(id)
	_ = os.Remove(filepath.Join(s.cfg.RunDir, id+".progress"))
	_ = os.Remove(filepath.Join(s.cfg.RunDir, id+".active-source"))
	_ = os.Remove(filepath.Join(s.cfg.RunDir, id+".active-index"))
	ch, _ := s.cfg.Store.GetChannel(id)
	if ch != nil && ch.LogoPath != nil {
		_ = os.Remove(*ch.LogoPath)
	}
	if err := s.cfg.Store.DeleteChannel(id); err != nil {
		writeErr(w, 404, "not found")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleStartChannel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := s.cfg.Store.GetChannel(id)
	if err != nil || ch == nil {
		writeErr(w, 404, "not found")
		return
	}
	progress := filepath.Join(s.cfg.RunDir, id+".progress")
	_ = os.Remove(progress)
	sources := ch.Sources
	if len(sources) == 0 {
		sources = []string{ch.Source}
	}
	if err := systemd.WriteChannelUnit(id, sources, ch.Output, progress); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	unit := systemd.ChannelUnitName(id)
	_ = systemd.Enable(unit)
	if err := systemd.Start(unit); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, s.channelStatusMap(*ch))
}

func (s *Server) handleStopChannel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := s.cfg.Store.GetChannel(id)
	if err != nil || ch == nil {
		writeErr(w, 404, "not found")
		return
	}
	_ = systemd.Stop(systemd.ChannelUnitName(id))
	writeJSON(w, 200, s.channelStatusMap(*ch))
}

// handleRepairChannels rewrites failover units from DB and restarts any that were active.
func (s *Server) handleRepairChannels(w http.ResponseWriter, _ *http.Request) {
	list, err := s.cfg.Store.ListChannels()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	type row struct {
		ID             string   `json:"id"`
		Name           string   `json:"name"`
		Sources        []string `json:"sources"`
		SourceCount    int      `json:"sourceCount"`
		WasActive      bool     `json:"wasActive"`
		Restarted      bool     `json:"restarted"`
		Error          string   `json:"error,omitempty"`
	}
	out := make([]row, 0, len(list))
	repaired, restarted, failed := 0, 0, 0
	for _, ch := range list {
		sources := ch.Sources
		if len(sources) == 0 && strings.TrimSpace(ch.Source) != "" {
			sources = []string{ch.Source}
		}
		item := row{
			ID:          ch.ID,
			Name:        ch.Name,
			Sources:     sources,
			SourceCount: len(sources),
		}
		unit := systemd.ChannelUnitName(ch.ID)
		wasActive, _ := systemd.IsActive(unit)
		item.WasActive = wasActive
		if len(sources) == 0 {
			item.Error = "sin fuentes"
			failed++
			out = append(out, item)
			continue
		}
		progress := filepath.Join(s.cfg.RunDir, ch.ID+".progress")
		if err := systemd.WriteChannelUnit(ch.ID, sources, ch.Output, progress); err != nil {
			item.Error = err.Error()
			failed++
			out = append(out, item)
			continue
		}
		_ = systemd.Enable(unit)
		repaired++
		if wasActive {
			_ = systemd.Stop(unit)
			if err := systemd.Start(unit); err != nil {
				item.Error = "rewrite ok, restart: " + err.Error()
				failed++
			} else {
				item.Restarted = true
				restarted++
			}
		}
		out = append(out, item)
	}
	writeJSON(w, 200, map[string]any{
		"channels":  out,
		"repaired":  repaired,
		"restarted": restarted,
		"failed":    failed,
		"total":     len(list),
	})
}

func (s *Server) handleChannelStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := s.cfg.Store.GetChannel(id)
	if err != nil || ch == nil {
		writeErr(w, 404, "not found")
		return
	}
	writeJSON(w, 200, s.channelStatusMap(*ch))
}

func (s *Server) channelStatusMap(ch store.Channel) map[string]any {
	unit := systemd.ChannelUnitName(ch.ID)
	ust, _ := systemd.Show(unit)
	progressPath := filepath.Join(s.cfg.RunDir, ch.ID+".progress")
	prog, _ := ffmpegstats.ReadProgress(progressPath)
	state := "stopped"
	if ust.ActiveState == "active" {
		state = "running"
	} else if ust.ActiveState == "failed" || ust.Result == "failed" {
		state = "error"
	} else if ust.ActiveState == "activating" {
		state = "starting"
	}

	// ffmpeg -c copy often writes progress sparsely (bitrate=N/A, mtime gaps).
	// A 20s stale window made the UI flap DOWN every poll even while the unit
	// was healthy. Prefer process liveness; only mark DOWN on long-dead progress.
	const progressFresh = 60 * time.Second
	const progressDeadAfter = 180 * time.Second
	link := "down"
	var progressAgeMs *int64
	verified := false
	if state == "running" || state == "starting" {
		alive := ust.MainPID > 0 || state == "starting"
		if !alive {
			link = "down"
		} else if prog == nil {
			// Just started; progress file not yet written
			link = "up"
		} else {
			age := time.Since(prog.UpdatedAt)
			ms := age.Milliseconds()
			progressAgeMs = &ms
			producing := prog.BitrateKbps > 0 || prog.OutTimeMs > 0 ||
				prog.Frame > 0 || prog.TotalSize > 0 || prog.Speed > 0
			if age > progressDeadAfter && !producing {
				link = "down"
			} else {
				link = "up"
				verified = age <= progressFresh && producing
			}
		}
	}

	out := map[string]any{
		"channelId":   ch.ID,
		"state":       state,
		"link":        link, // up | down — verified stream health
		"verified":    verified,
		"unit":        unit,
		"activeState": ust.ActiveState,
		"subState":    ust.SubState,
		"mainPid":     ust.MainPID,
		"reconnects":  ust.NRestarts,
		"result":      ust.Result,
		"source":      ch.Source,
		"sources":     ch.Sources,
		"output":      ch.Output,
	}
	activeSource := ch.Source
	activeIdx := 0
	if b, err := os.ReadFile(filepath.Join(s.cfg.RunDir, ch.ID+".active-source")); err == nil {
		if t := strings.TrimSpace(string(b)); t != "" {
			activeSource = t
		}
	}
	if b, err := os.ReadFile(filepath.Join(s.cfg.RunDir, ch.ID+".active-index")); err == nil {
		fmt.Sscanf(strings.TrimSpace(string(b)), "%d", &activeIdx)
	}
	out["activeSource"] = activeSource
	out["activeSourceIndex"] = activeIdx
	if progressAgeMs != nil {
		out["progressAgeMs"] = *progressAgeMs
	}
	if prog != nil {
		out["bitrateKbps"] = prog.BitrateKbps
		out["fps"] = prog.FPS
		out["dropFrames"] = prog.DropFrames
		out["dupFrames"] = prog.DupFrames
		out["speed"] = prog.Speed
		out["outTimeMs"] = prog.OutTimeMs
		if pl := ffmpegstats.PacketLossEstimate(prog); pl != nil {
			out["packetLossPercent"] = *pl
		}
	}
	return out
}

func (s *Server) handleUploadLogo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := s.cfg.Store.GetChannel(id)
	if err != nil || ch == nil {
		writeErr(w, 404, "not found")
		return
	}
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeErr(w, 400, "multipart required")
		return
	}
	file, hdr, err := r.FormFile("logo")
	if err != nil {
		writeErr(w, 400, "logo field required")
		return
	}
	defer file.Close()
	ext := strings.ToLower(filepath.Ext(hdr.Filename))
	if ext == "" {
		ext = ".png"
	}
	dst := filepath.Join(s.cfg.LogosDir, id+ext)
	out, err := os.Create(dst)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, file); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_ = s.cfg.Store.SetChannelLogo(id, dst)
	got, _ := s.cfg.Store.GetChannel(id)
	writeJSON(w, 200, map[string]any{"channel": got})
}

func (s *Server) handleGetLogo(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	ch, err := s.cfg.Store.GetChannel(id)
	if err != nil || ch == nil || ch.LogoPath == nil {
		writeErr(w, 404, "not found")
		return
	}
	http.ServeFile(w, r, *ch.LogoPath)
}

func (s *Server) handleListEpg(w http.ResponseWriter, _ *http.Request) {
	list, err := s.cfg.Store.ListEpgProviders()
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"providers": list})
}

func (s *Server) handleCreateEpg(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name           string `json:"name"`
		URL            string `json:"url"`
		RefreshMinutes int    `json:"refreshMinutes"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	name := strings.TrimSpace(body.Name)
	url := strings.TrimSpace(body.URL)
	if name == "" || url == "" {
		writeErr(w, 400, "name and url required")
		return
	}
	mins := body.RefreshMinutes
	if mins <= 0 {
		mins = 360
	}
	p := store.EpgProvider{ID: newID(), Name: name, URL: url, RefreshMinutes: mins, CreatedAt: time.Now().UTC()}
	if err := s.cfg.Store.UpsertEpgProvider(p); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	got, _ := s.cfg.Store.GetEpgProvider(p.ID)
	writeJSON(w, 201, got)
}

func (s *Server) handlePatchEpg(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cur, err := s.cfg.Store.GetEpgProvider(id)
	if err != nil || cur == nil {
		writeErr(w, 404, "not found")
		return
	}
	var body struct {
		Name           *string `json:"name"`
		URL            *string `json:"url"`
		RefreshMinutes *int    `json:"refreshMinutes"`
	}
	if err := readJSON(r, &body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if body.Name != nil {
		cur.Name = strings.TrimSpace(*body.Name)
	}
	if body.URL != nil {
		cur.URL = strings.TrimSpace(*body.URL)
	}
	if body.RefreshMinutes != nil && *body.RefreshMinutes > 0 {
		cur.RefreshMinutes = *body.RefreshMinutes
	}
	if err := s.cfg.Store.UpsertEpgProvider(*cur); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	got, _ := s.cfg.Store.GetEpgProvider(id)
	writeJSON(w, 200, got)
}

func (s *Server) handleDeleteEpg(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.cfg.Store.DeleteEpgProvider(id); err != nil {
		writeErr(w, 404, "not found")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleRefreshEpg(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := s.cfg.Store.GetEpgProvider(id)
	if err != nil || p == nil {
		writeErr(w, 404, "not found")
		return
	}
	chans, err := epg.FetchChannels(p.URL)
	now := time.Now().UTC()
	if err != nil {
		msg := err.Error()
		_ = s.cfg.Store.SetEpgRefresh(id, now, &msg)
		writeErr(w, 502, msg)
		return
	}
	for i := range chans {
		chans[i].ProviderID = id
	}
	if err := s.cfg.Store.ReplaceEpgChannels(id, chans); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	_ = s.cfg.Store.SetEpgRefresh(id, now, nil)
	got, _ := s.cfg.Store.GetEpgProvider(id)
	writeJSON(w, 200, map[string]any{"provider": got, "channels": len(chans)})
}

func (s *Server) handleListEpgChannels(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	list, err := s.cfg.Store.ListEpgChannels(id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"channels": list})
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
