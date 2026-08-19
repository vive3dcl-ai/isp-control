package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type Category struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type Channel struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	CategoryID    *string   `json:"categoryId"`
	LogoPath      *string   `json:"logoPath"`
	LogoURL       *string   `json:"logoUrl"`
	Source        string    `json:"source"`  // primary = Sources[0]
	Sources       []string  `json:"sources"` // primary + backups (failover order)
	Output        string    `json:"output"`
	EpgProviderID *string   `json:"epgProviderId"`
	EpgChannelKey *string   `json:"epgChannelKey"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

// NormalizeSources trims empties; ensures at least primary if provided.
func NormalizeSources(primary string, sources []string) []string {
	var out []string
	seen := map[string]struct{}{}
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s == "" {
			return
		}
		if _, ok := seen[s]; ok {
			return
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	if len(sources) > 0 {
		for _, s := range sources {
			add(s)
		}
	} else {
		add(primary)
	}
	return out
}

type EpgProvider struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	URL             string     `json:"url"`
	RefreshMinutes  int        `json:"refreshMinutes"`
	LastRefreshAt   *time.Time `json:"lastRefreshAt"`
	LastError       *string    `json:"lastError"`
	ChannelCount    int        `json:"channelCount"`
	CreatedAt       time.Time  `json:"createdAt"`
}

type EpgChannel struct {
	ProviderID string `json:"providerId"`
	Key        string `json:"key"`
	Display    string `json:"display"`
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id TEXT NULL,
  logo_path TEXT NULL,
  source TEXT NOT NULL,
  sources_json TEXT NULL,
  output TEXT NOT NULL,
  epg_provider_id TEXT NULL,
  epg_channel_key TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS epg_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  refresh_minutes INTEGER NOT NULL DEFAULT 360,
  last_refresh_at TEXT NULL,
  last_error TEXT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS epg_channels (
  provider_id TEXT NOT NULL,
  key TEXT NOT NULL,
  display TEXT NOT NULL,
  PRIMARY KEY (provider_id, key)
);
`)
	if err != nil {
		return err
	}
	// Best-effort migration for multi-source failover.
	_, _ = s.db.Exec(`ALTER TABLE channels ADD COLUMN sources_json TEXT`)
	return nil
}

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func parseTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t, _ = time.Parse(time.RFC3339, s)
	}
	return t
}

func nullStr(ns sql.NullString) *string {
	if !ns.Valid {
		return nil
	}
	v := ns.String
	return &v
}

func (s *Store) ListCategories() ([]Category, error) {
	rows, err := s.db.Query(`SELECT id, name, created_at FROM categories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Category
	for rows.Next() {
		var c Category
		var ca string
		if err := rows.Scan(&c.ID, &c.Name, &ca); err != nil {
			return nil, err
		}
		c.CreatedAt = parseTime(ca)
		out = append(out, c)
	}
	if out == nil {
		out = []Category{}
	}
	return out, rows.Err()
}

func (s *Store) CreateCategory(id, name string) (Category, error) {
	ca := now()
	_, err := s.db.Exec(`INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)`, id, name, ca)
	if err != nil {
		return Category{}, err
	}
	return Category{ID: id, Name: name, CreatedAt: parseTime(ca)}, nil
}

func (s *Store) DeleteCategory(id string) error {
	res, err := s.db.Exec(`DELETE FROM categories WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (s *Store) GetCategory(id string) (*Category, error) {
	var c Category
	var ca string
	err := s.db.QueryRow(`SELECT id, name, created_at FROM categories WHERE id = ?`, id).Scan(&c.ID, &c.Name, &ca)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.CreatedAt = parseTime(ca)
	return &c, nil
}

func scanChannel(scanner interface {
	Scan(dest ...any) error
}) (Channel, error) {
	var c Channel
	var cat, logo, epgP, epgK, sourcesJSON sql.NullString
	var ca, ua string
	err := scanner.Scan(&c.ID, &c.Name, &cat, &logo, &c.Source, &sourcesJSON, &c.Output, &epgP, &epgK, &ca, &ua)
	if err != nil {
		return c, err
	}
	c.CategoryID = nullStr(cat)
	c.LogoPath = nullStr(logo)
	c.EpgProviderID = nullStr(epgP)
	c.EpgChannelKey = nullStr(epgK)
	c.CreatedAt = parseTime(ca)
	c.UpdatedAt = parseTime(ua)
	if sourcesJSON.Valid && strings.TrimSpace(sourcesJSON.String) != "" {
		_ = json.Unmarshal([]byte(sourcesJSON.String), &c.Sources)
	}
	c.Sources = NormalizeSources(c.Source, c.Sources)
	if len(c.Sources) > 0 {
		c.Source = c.Sources[0]
	}
	if c.LogoPath != nil {
		u := "/v1/logos/" + c.ID
		c.LogoURL = &u
	}
	return c, nil
}

const channelSelect = `SELECT id, name, category_id, logo_path, source, sources_json, output, epg_provider_id, epg_channel_key, created_at, updated_at FROM channels`

func (s *Store) ListChannels() ([]Channel, error) {
	rows, err := s.db.Query(channelSelect + ` ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Channel
	for rows.Next() {
		c, err := scanChannel(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []Channel{}
	}
	return out, rows.Err()
}

func (s *Store) GetChannel(id string) (*Channel, error) {
	row := s.db.QueryRow(channelSelect+` WHERE id = ?`, id)
	c, err := scanChannel(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) UpsertChannel(c Channel) error {
	ua := now()
	if c.CreatedAt.IsZero() {
		c.CreatedAt = parseTime(ua)
	}
	c.Sources = NormalizeSources(c.Source, c.Sources)
	if len(c.Sources) == 0 {
		return fmt.Errorf("at least one source required")
	}
	c.Source = c.Sources[0]
	sj, err := json.Marshal(c.Sources)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
INSERT INTO channels (id, name, category_id, logo_path, source, sources_json, output, epg_provider_id, epg_channel_key, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  category_id=excluded.category_id,
  logo_path=COALESCE(excluded.logo_path, channels.logo_path),
  source=excluded.source,
  sources_json=excluded.sources_json,
  output=excluded.output,
  epg_provider_id=excluded.epg_provider_id,
  epg_channel_key=excluded.epg_channel_key,
  updated_at=excluded.updated_at
`, c.ID, c.Name, c.CategoryID, c.LogoPath, c.Source, string(sj), c.Output, c.EpgProviderID, c.EpgChannelKey, c.CreatedAt.UTC().Format(time.RFC3339Nano), ua)
	return err
}

func (s *Store) SetChannelLogo(id, path string) error {
	_, err := s.db.Exec(`UPDATE channels SET logo_path = ?, updated_at = ? WHERE id = ?`, path, now(), id)
	return err
}

func (s *Store) DeleteChannel(id string) error {
	res, err := s.db.Exec(`DELETE FROM channels WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (s *Store) ListEpgProviders() ([]EpgProvider, error) {
	rows, err := s.db.Query(`SELECT id, name, url, refresh_minutes, last_refresh_at, last_error, created_at FROM epg_providers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EpgProvider
	for rows.Next() {
		var p EpgProvider
		var lr, le sql.NullString
		var ca string
		if err := rows.Scan(&p.ID, &p.Name, &p.URL, &p.RefreshMinutes, &lr, &le, &ca); err != nil {
			return nil, err
		}
		if lr.Valid {
			t := parseTime(lr.String)
			p.LastRefreshAt = &t
		}
		p.LastError = nullStr(le)
		p.CreatedAt = parseTime(ca)
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM epg_channels WHERE provider_id = ?`, p.ID).Scan(&p.ChannelCount)
		out = append(out, p)
	}
	if out == nil {
		out = []EpgProvider{}
	}
	return out, rows.Err()
}

func (s *Store) GetEpgProvider(id string) (*EpgProvider, error) {
	var p EpgProvider
	var lr, le sql.NullString
	var ca string
	err := s.db.QueryRow(`SELECT id, name, url, refresh_minutes, last_refresh_at, last_error, created_at FROM epg_providers WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.URL, &p.RefreshMinutes, &lr, &le, &ca)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if lr.Valid {
		t := parseTime(lr.String)
		p.LastRefreshAt = &t
	}
	p.LastError = nullStr(le)
	p.CreatedAt = parseTime(ca)
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM epg_channels WHERE provider_id = ?`, p.ID).Scan(&p.ChannelCount)
	return &p, nil
}

func (s *Store) UpsertEpgProvider(p EpgProvider) error {
	ca := now()
	if !p.CreatedAt.IsZero() {
		ca = p.CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	_, err := s.db.Exec(`
INSERT INTO epg_providers (id, name, url, refresh_minutes, last_refresh_at, last_error, created_at)
VALUES (?, ?, ?, ?, NULL, NULL, ?)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  url=excluded.url,
  refresh_minutes=excluded.refresh_minutes
`, p.ID, p.Name, p.URL, p.RefreshMinutes, ca)
	return err
}

func (s *Store) SetEpgRefresh(id string, at time.Time, errMsg *string) error {
	var e any
	if errMsg != nil {
		e = *errMsg
	}
	_, err := s.db.Exec(`UPDATE epg_providers SET last_refresh_at = ?, last_error = ? WHERE id = ?`,
		at.UTC().Format(time.RFC3339Nano), e, id)
	return err
}

func (s *Store) DeleteEpgProvider(id string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM epg_channels WHERE provider_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.Exec(`DELETE FROM epg_providers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	return tx.Commit()
}

func (s *Store) ReplaceEpgChannels(providerID string, chans []EpgChannel) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM epg_channels WHERE provider_id = ?`, providerID); err != nil {
		return err
	}
	for _, c := range chans {
		if _, err := tx.Exec(`INSERT INTO epg_channels (provider_id, key, display) VALUES (?, ?, ?)`,
			providerID, c.Key, c.Display); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) ListEpgChannels(providerID string) ([]EpgChannel, error) {
	rows, err := s.db.Query(`SELECT provider_id, key, display FROM epg_channels WHERE provider_id = ? ORDER BY display`, providerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EpgChannel
	for rows.Next() {
		var c EpgChannel
		if err := rows.Scan(&c.ProviderID, &c.Key, &c.Display); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []EpgChannel{}
	}
	return out, rows.Err()
}
