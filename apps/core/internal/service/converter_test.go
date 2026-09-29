package service

import (
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestCompanionBinaryPathPreservesExtension(t *testing.T) {
	path := companionBinaryPath(filepath.Join("deps", "ffmpeg.exe"), "ffprobe")
	if got, want := filepath.Base(path), "ffprobe.exe"; got != want {
		t.Fatalf("companionBinaryPath() = %q, want %q", got, want)
	}

	if runtime.GOOS != "windows" {
		path = companionBinaryPath(filepath.Join("deps", "ffmpeg"), "ffprobe")
		if got, want := filepath.Base(path), "ffprobe"; got != want {
			t.Fatalf("companionBinaryPath() = %q, want %q", got, want)
		}
	}
}

func TestParseFFmpegDuration(t *testing.T) {
	output := "Duration: 01:02:03.50, start: 0.000000, bitrate: 601 kb/s"
	if got, want := parseFFmpegDuration(output), time.Hour+2*time.Minute+3500*time.Millisecond; got != want {
		t.Fatalf("parseFFmpegDuration() = %s, want %s", got, want)
	}
}

func TestFormatFFmpegFailureIdentifiesMissingAudio(t *testing.T) {
	err := formatFFmpegFailure("mp3", errors.New("exit status 1"), []string{
		"Output #0, mp3, to 'example.mp3':",
		"[out#0/mp3] Output file does not contain any stream",
	})
	if got, want := err.Error(), "source file has no audio stream"; got != want {
		t.Fatalf("formatFFmpegFailure() = %q, want %q", got, want)
	}
}

func TestFormatFFmpegFailureKeepsUsefulDetail(t *testing.T) {
	err := formatFFmpegFailure("mp4", errors.New("exit status 1"), []string{
		"Input #0, mov, from 'example.mov':",
		"example.mp4: Permission denied",
	})
	if !strings.Contains(err.Error(), "Permission denied") {
		t.Fatalf("formatFFmpegFailure() = %q, want permission detail", err)
	}
}
