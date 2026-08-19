package epg

import (
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/isp-control/tv-agent/internal/store"
)

type xmltv struct {
	Channels []xmlChannel `xml:"channel"`
}

type xmlChannel struct {
	ID          string   `xml:"id,attr"`
	DisplayName []string `xml:"display-name"`
}

func FetchChannels(url string) ([]store.EpgChannel, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("epg http %d", resp.StatusCode)
	}
	// Limit to 64MB
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	var doc xmltv
	if err := xml.Unmarshal(body, &doc); err != nil {
		return nil, err
	}
	out := make([]store.EpgChannel, 0, len(doc.Channels))
	for _, ch := range doc.Channels {
		display := ch.ID
		if len(ch.DisplayName) > 0 && ch.DisplayName[0] != "" {
			display = ch.DisplayName[0]
		}
		out = append(out, store.EpgChannel{Key: ch.ID, Display: display})
	}
	return out, nil
}
