package store

import "testing"

func TestNormalizeSources(t *testing.T) {
	got := NormalizeSources(" http://a ", []string{"http://a", " http://b ", "", "http://b", "http://c"})
	if len(got) != 3 || got[0] != "http://a" || got[1] != "http://b" || got[2] != "http://c" {
		t.Fatalf("unexpected: %#v", got)
	}
	got = NormalizeSources("http://only", nil)
	if len(got) != 1 || got[0] != "http://only" {
		t.Fatalf("primary only: %#v", got)
	}
	got = NormalizeSources("", []string{"", "  "})
	if len(got) != 0 {
		t.Fatalf("empty: %#v", got)
	}
}
