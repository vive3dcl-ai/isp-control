package ffmpegstats

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"time"
)

type Progress struct {
	Frame       int64   `json:"frame"`
	FPS         float64 `json:"fps"`
	BitrateKbps float64 `json:"bitrateKbps"`
	TotalSize   int64   `json:"totalSize"`
	OutTimeMs   int64   `json:"outTimeMs"`
	DupFrames   int64   `json:"dupFrames"`
	DropFrames  int64   `json:"dropFrames"`
	Speed       float64 `json:"speed"`
	Progress    string  `json:"progress"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func ReadProgress(path string) (*Progress, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// Keep last key=value block (ffmpeg writes repeatedly).
	vals := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		vals[k] = v
	}
	if len(vals) == 0 {
		return nil, os.ErrNotExist
	}
	p := &Progress{UpdatedAt: st.ModTime().UTC()}
	p.Frame, _ = strconv.ParseInt(vals["frame"], 10, 64)
	p.FPS, _ = strconv.ParseFloat(vals["fps"], 64)
	br := strings.TrimSuffix(strings.TrimSpace(vals["bitrate"]), "kbits/s")
	p.BitrateKbps, _ = strconv.ParseFloat(strings.TrimSpace(br), 64)
	p.TotalSize, _ = strconv.ParseInt(vals["total_size"], 10, 64)
	p.OutTimeMs, _ = strconv.ParseInt(vals["out_time_ms"], 10, 64)
	p.DupFrames, _ = strconv.ParseInt(vals["dup_frames"], 10, 64)
	p.DropFrames, _ = strconv.ParseInt(vals["drop_frames"], 10, 64)
	sp := strings.TrimSuffix(vals["speed"], "x")
	p.Speed, _ = strconv.ParseFloat(sp, 64)
	p.Progress = vals["progress"]
	return p, nil
}

// PacketLossEstimate is drop/(frame+drop) when frames known.
func PacketLossEstimate(p *Progress) *float64 {
	if p == nil {
		return nil
	}
	den := p.Frame + p.DropFrames
	if den <= 0 {
		return nil
	}
	v := float64(p.DropFrames) / float64(den) * 100
	return &v
}
