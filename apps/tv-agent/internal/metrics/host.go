package metrics

import (
	"bufio"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

type HostMetrics struct {
	CPUPercent   float64    `json:"cpuPercent"`
	RAMUsedBytes uint64     `json:"ramUsedBytes"`
	RAMTotalBytes uint64    `json:"ramTotalBytes"`
	RAMPercent   float64    `json:"ramPercent"`
	Load1        float64    `json:"load1"`
	UptimeSec    float64    `json:"uptimeSec"`
	GPU          *GPUInfo   `json:"gpu"`
	GoRoutines   int        `json:"goRoutines"`
	CollectedAt  time.Time  `json:"collectedAt"`
}

type GPUInfo struct {
	Name        string  `json:"name"`
	UtilPercent float64 `json:"utilPercent"`
	MemUsedMB   float64 `json:"memUsedMb"`
	MemTotalMB  float64 `json:"memTotalMb"`
}

var (
	cpuMu     sync.Mutex
	prevIdle  uint64
	prevTotal uint64
	havePrev  bool
)

func Collect() HostMetrics {
	m := HostMetrics{
		CollectedAt: time.Now().UTC(),
		GoRoutines:  runtime.NumGoroutine(),
	}
	m.CPUPercent = cpuPercent()
	used, total := mem()
	m.RAMUsedBytes = used
	m.RAMTotalBytes = total
	if total > 0 {
		m.RAMPercent = float64(used) / float64(total) * 100
	}
	m.Load1 = load1()
	m.UptimeSec = uptime()
	m.GPU = gpu()
	return m
}

func cpuPercent() float64 {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	if !sc.Scan() {
		return 0
	}
	fields := strings.Fields(sc.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0
	}
	var nums []uint64
	for _, f := range fields[1:] {
		n, _ := strconv.ParseUint(f, 10, 64)
		nums = append(nums, n)
	}
	var idle, total uint64
	if len(nums) > 3 {
		idle = nums[3]
	}
	for _, n := range nums {
		total += n
	}
	cpuMu.Lock()
	defer cpuMu.Unlock()
	if !havePrev {
		prevIdle, prevTotal, havePrev = idle, total, true
		return 0
	}
	di := idle - prevIdle
	dt := total - prevTotal
	prevIdle, prevTotal = idle, total
	if dt == 0 {
		return 0
	}
	return (1 - float64(di)/float64(dt)) * 100
}

func mem() (used, total uint64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	var memTotal, memAvail uint64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			memTotal = parseMemKB(line) * 1024
		} else if strings.HasPrefix(line, "MemAvailable:") {
			memAvail = parseMemKB(line) * 1024
		}
	}
	if memTotal >= memAvail {
		return memTotal - memAvail, memTotal
	}
	return 0, memTotal
}

func parseMemKB(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	n, _ := strconv.ParseUint(fields[1], 10, 64)
	return n
}

func load1() float64 {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) < 1 {
		return 0
	}
	v, _ := strconv.ParseFloat(fields[0], 64)
	return v
}

func uptime() float64 {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) < 1 {
		return 0
	}
	v, _ := strconv.ParseFloat(fields[0], 64)
	return v
}

func gpu() *GPUInfo {
	out, err := exec.Command("nvidia-smi",
		"--query-gpu=name,utilization.gpu,memory.used,memory.total",
		"--format=csv,noheader,nounits").CombinedOutput()
	if err != nil {
		return nil
	}
	line := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	parts := strings.Split(line, ",")
	if len(parts) < 4 {
		return nil
	}
	util, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	memUsed, _ := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
	memTotal, _ := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64)
	return &GPUInfo{
		Name:        strings.TrimSpace(parts[0]),
		UtilPercent: util,
		MemUsedMB:   memUsed,
		MemTotalMB:  memTotal,
	}
}
