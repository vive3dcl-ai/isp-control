package systemd

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const unitDir = "/etc/systemd/system"
const scriptsDir = "/var/lib/isp-tv/scripts"

func ChannelUnitName(channelID string) string {
	safe := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, channelID)
	return fmt.Sprintf("isp-tv-ch-%s.service", safe)
}

// WriteChannelUnit writes the channel ffmpeg unit.
// One source → simple exec (same stability as before).
// Several sources → failover wrapper with hysteresis (retry primary, stable failback).
func WriteChannelUnit(channelID string, sources []string, output, progressFile string) error {
	if len(sources) == 0 {
		return fmt.Errorf("no sources")
	}
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		return err
	}
	runDir := filepath.Dir(progressFile)
	_ = os.MkdirAll(runDir, 0o755)
	activeFile := filepath.Join(runDir, channelID+".active-source")
	indexFile := filepath.Join(runDir, channelID+".active-index")

	ffmpegBin := FfmpegPath()
	scriptPath := filepath.Join(scriptsDir, ChannelUnitName(channelID)+".sh")

	var script string
	if len(sources) == 1 {
		// Stable path: identical to pre-failover behavior (systemd reconnects).
		script = fmt.Sprintf(`#!/bin/sh
# Single source — exec ffmpeg; systemd Restart=always handles reconnects.
printf '0\n' > %s
printf '%%s\n' %s > %s
exec %s -hide_banner -loglevel warning -nostdin -i %s -c copy -f mpegts -progress %s -y %s
`,
			shellQuote(indexFile),
			shellQuote(sources[0]), shellQuote(activeFile),
			shellQuote(ffmpegBin), shellQuote(sources[0]),
			shellQuote(progressFile), shellQuote(output),
		)
	} else {
		var srcDecl strings.Builder
		srcDecl.WriteString("SOURCES=(\n")
		for _, src := range sources {
			srcDecl.WriteString("  ")
			srcDecl.WriteString(shellQuote(src))
			srcDecl.WriteByte('\n')
		}
		srcDecl.WriteString(")\n")

		script = fmt.Sprintf(`#!/bin/bash
# Multi-source failover with hysteresis — avoid flapping.
set +e
FFMPEG=%s
PROGRESS=%s
OUTPUT=%s
ACTIVE_FILE=%s
INDEX_FILE=%s
PROBE_SEC=30
PRIMARY_RETRIES=3
FAILBACK_NEED=2
%s
n=${#SOURCES[@]}

probe_ok() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 8 "$FFMPEG" -hide_banner -loglevel error -nostdin \
      -rw_timeout 5000000 -i "$1" -t 1 -f null - >/dev/null 2>&1
  else
    "$FFMPEG" -hide_banner -loglevel error -nostdin \
      -rw_timeout 5000000 -i "$1" -t 1 -f null - >/dev/null 2>&1
  fi
}

run_ffmpeg() {
  local src="$1"
  : > "$PROGRESS"
  "$FFMPEG" -hide_banner -loglevel warning -nostdin -i "$src" -c copy -f mpegts \
    -progress "$PROGRESS" -y "$OUTPUT"
}

idx=0
primary_fails=0
failback_ok=0
while true; do
  if [[ $idx -lt 0 || $idx -ge $n ]]; then
    idx=0
  fi
  src="${SOURCES[$idx]}"
  printf '%%s\n' "$idx" > "$INDEX_FILE"
  printf '%%s\n' "$src" > "$ACTIVE_FILE"

  if [[ $idx -eq 0 ]]; then
    run_ffmpeg "$src"
    primary_fails=$((primary_fails + 1))
    if [[ $primary_fails -lt $PRIMARY_RETRIES ]]; then
      sleep 2
      continue
    fi
    primary_fails=0
    failback_ok=0
    idx=1
    sleep 1
    continue
  fi

  # Backup: stream + require consecutive successful probes before returning to primary.
  run_ffmpeg "$src" &
  fpid=$!
  switched=0
  while kill -0 "$fpid" 2>/dev/null; do
    sleep "$PROBE_SEC"
    if ! kill -0 "$fpid" 2>/dev/null; then
      break
    fi
    if probe_ok "${SOURCES[0]}"; then
      failback_ok=$((failback_ok + 1))
    else
      failback_ok=0
    fi
    if [[ $failback_ok -ge $FAILBACK_NEED ]]; then
      kill "$fpid" 2>/dev/null
      wait "$fpid" 2>/dev/null
      idx=0
      primary_fails=0
      failback_ok=0
      switched=1
      break
    fi
  done
  if [[ $switched -eq 1 ]]; then
    continue
  fi
  wait "$fpid" 2>/dev/null
  next=$((idx + 1))
  if [[ $next -ge $n ]]; then
    idx=0
    primary_fails=0
  else
    idx=$next
  fi
  sleep 2
done
`, shellQuote(ffmpegBin), shellQuote(progressFile), shellQuote(output),
			shellQuote(activeFile), shellQuote(indexFile), srcDecl.String())
	}

	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		return err
	}
	_ = os.Chown(scriptPath, 0, 0)

	name := ChannelUnitName(channelID)
	body := fmt.Sprintf(`[Unit]
Description=ISP TV channel %s
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=isp-tv
Group=isp-tv
ExecStart=%s
Restart=always
RestartSec=2
Nice=5
KillMode=control-group

[Install]
WantedBy=multi-user.target
`, channelID, scriptPath)

	path := filepath.Join(unitDir, name)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		return err
	}
	return daemonReload()
}

func RemoveChannelUnit(channelID string) error {
	name := ChannelUnitName(channelID)
	_ = Stop(name)
	_ = exec.Command("systemctl", "disable", name).Run()
	path := filepath.Join(unitDir, name)
	_ = os.Remove(path)
	_ = os.Remove(filepath.Join(scriptsDir, name+".sh"))
	return daemonReload()
}

func Start(unit string) error {
	return run("systemctl", "start", unit)
}

func Stop(unit string) error {
	return run("systemctl", "stop", unit)
}

func Enable(unit string) error {
	return run("systemctl", "enable", unit)
}

func IsActive(unit string) (bool, error) {
	out, err := exec.Command("systemctl", "is-active", unit).CombinedOutput()
	state := strings.TrimSpace(string(out))
	if state == "active" {
		return true, nil
	}
	if err != nil {
		return false, nil
	}
	return false, nil
}

type UnitStatus struct {
	ActiveState    string `json:"activeState"`
	SubState       string `json:"subState"`
	MainPID        int    `json:"mainPid"`
	NRestarts      int    `json:"nRestarts"`
	ActiveEnter    string `json:"activeEnterTimestamp"`
	Result         string `json:"result"`
	ExecMainStatus int    `json:"execMainStatus"`
}

func Show(unit string) (UnitStatus, error) {
	out, err := exec.Command("systemctl", "show", unit,
		"--property=ActiveState,SubState,MainPID,NRestarts,ActiveEnterTimestamp,Result,ExecMainStatus").CombinedOutput()
	if err != nil && len(out) == 0 {
		return UnitStatus{}, err
	}
	st := UnitStatus{}
	for _, line := range strings.Split(string(out), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		switch k {
		case "ActiveState":
			st.ActiveState = v
		case "SubState":
			st.SubState = v
		case "MainPID":
			fmt.Sscanf(v, "%d", &st.MainPID)
		case "NRestarts":
			fmt.Sscanf(v, "%d", &st.NRestarts)
		case "ActiveEnterTimestamp":
			st.ActiveEnter = v
		case "Result":
			st.Result = v
		case "ExecMainStatus":
			fmt.Sscanf(v, "%d", &st.ExecMainStatus)
		}
	}
	return st, nil
}

func daemonReload() error {
	return run("systemctl", "daemon-reload")
}

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %w (%s)", name, args, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func FfmpegPath() string {
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	// XtreamUI / common layouts — reuse only; never install.
	candidates := []string{
		"/usr/bin/ffmpeg",
		"/usr/local/bin/ffmpeg",
		"/home/xtreamcodes/iptv_xtream_codes/php/bin/ffmpeg",
		"/home/xtreamcodes/iptv_xtream_codes/bin/ffmpeg",
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	return "/usr/bin/ffmpeg"
}
